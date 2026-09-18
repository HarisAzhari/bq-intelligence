"""Persistent BOM/supplier jobs. No PDF work or network requests hold the app lock."""
import copy
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import HTTPException
from backend import bom, suppliers
from backend.ingestion import atomic


class Jobs:
    def __init__(self, folder, lock, ai_settings, documents_busy):
        self.folder, self.lock, self.ai_settings, self.documents_busy = folder, lock, ai_settings, documents_busy
        self.active = {}
        self.guard = threading.RLock()

    def key(self, pid, kind):
        return (str(self.folder(pid)), kind)

    def busy(self, pid):
        with self.guard:
            return any(self.key(pid, kind) in self.active for kind in ('bom', 'suppliers'))

    def status(self, pid, kind):
        with self.guard:
            value = bom.load(self.folder(pid) / f'{kind}-job.json', dict(status='idle', phase='idle'))
            if value['status'] in ('queued', 'running', 'cancelling') and self.key(pid, kind) not in self.active:
                value.update(status='interrupted', message='Server restarted. Saved results remain available; resume explicitly.', finished_at=bom.now())
                atomic(self.folder(pid) / f'{kind}-job.json', value)
            return value

    def update(self, pid, kind, **changes):
        with self.guard:
            path = self.folder(pid) / f'{kind}-job.json'
            value = bom.load(path, {})
            value.update(changes, heartbeat_at=bom.now())
            atomic(path, value)

    def cancel(self, pid, kind):
        with self.guard:
            event = self.active.get(self.key(pid, kind))
            if event:
                event.set()
                self.update(pid, kind, status='cancelling', message='Stopping after in-flight requests finish. Completed work is retained.')
        return self.status(pid, kind)

    def start(self, pid, kind, force=False):
        with self.lock, self.guard:
            if self.busy(pid) or self.documents_busy(pid):
                raise HTTPException(409, 'A document or Procurement job is already active. Wait for it to finish.')
            settings = self.ai_settings()
            if not settings.get('key'):
                raise HTTPException(400, 'Add your OpenRouter key in AI settings first.')
            directory = self.folder(pid)
            current = bom.load(directory / 'bom.json', None)
            if kind == 'suppliers' and (not current or current['manifest'] != bom.manifest(directory)):
                raise HTTPException(409, 'Generate a current AI BOM before finding suppliers.')
            event = threading.Event()
            self.active[self.key(pid, kind)] = event
            atomic(directory / f'{kind}-job.json', dict(status='queued', phase='queued', started_at=bom.now(),
                heartbeat_at=bom.now(), message='Queued', done=0, total=0, failed=0, unavailable=0,
                model=settings['model'], force=force, usage={}, finished_at=None))
            threading.Thread(target=self.run, args=(pid, kind, event, settings, force), daemon=True).start()
        return self.status(pid, kind)

    def run(self, pid, kind, event, settings, force):
        finished = threading.Event()
        def heartbeat():
            while not finished.wait(2):
                self.update(pid, kind)
        threading.Thread(target=heartbeat, daemon=True).start()
        update = lambda **changes: self.update(pid, kind, **changes)
        try:
            update(status='running')
            if kind == 'bom':
                result, cached = bom.generate(self.folder(pid), settings['key'], settings['model'], update, event.is_set, force)
                if event.is_set():
                    raise InterruptedError('Cancelled before publishing. Completed results can be reused.')
                update(phase='saving', message='Saving the validated BOM.')
                with self.lock:
                    if result['manifest'] != bom.manifest(self.folder(pid)):
                        raise ValueError('Documents changed during generation. The old BOM is preserved; generate again.')
                    atomic(self.folder(pid) / 'bom.json', result)
                    self.bump_revision(pid)
                    history = bom.load(self.folder(pid) / 'bom-history.json', [])
                    if not any(h['version'] == result['version'] for h in history):
                        history.append({k: result[k] for k in ('version', 'fingerprint', 'model', 'created_at', 'usage')})
                        atomic(self.folder(pid) / 'bom-history.json', history)
                update(status='complete', phase='complete', message='Loaded saved AI BOM.' if cached else 'AI BOM saved.',
                       reused=cached, usage=dict(requests=0, tokens=0, reported_cost_usd=0) if cached else result['usage'])
            else:
                self.search_batch(pid, settings, event, update, force)
        except InterruptedError as exc:
            update(status='cancelled', phase='cancelled', message=str(exc))
        except Exception as exc:
            message = str(exc) if isinstance(exc, ValueError) else getattr(exc, 'detail', 'Processing failed. Saved results are preserved; retry explicitly.')
            # Avoid returning provider payloads, credentials, or model validation dumps.
            if len(message) > 600:
                message = 'AI output failed validation. Saved results are preserved; retry explicitly.'
            update(status='failed', phase='failed', message=message)
        finally:
            finished.set()
            with self.guard:
                self.update(pid, kind, finished_at=bom.now())
                self.active.pop(self.key(pid, kind), None)

    def search_batch(self, pid, settings, event, update, force):
        directory = self.folder(pid)
        snapshot = bom.load(directory / 'bom.json', {})
        items = snapshot['items']
        records = bom.load(directory / 'supplier-results.json', {})
        cache = directory / 'ai-cache' / 'suppliers'
        cache.mkdir(parents=True, exist_ok=True)
        total = len(items)
        counts = dict(done=0, failed=0, unavailable=0, skipped=0, reused=0)
        usages = []
        update(phase='searching', total=total, message='Searching suppliers using AI-selected filters. At most two materials run at once.')

        def work(item):
            if event.is_set():
                return None
            fingerprint = supplier_key(item, settings['model'])
            target = cache / (fingerprint + '.json')
            if not force and target.exists():
                value = bom.load(target, {})
                value['reused'] = True
                return value
            if not item.get('search_ready'):
                return dict(item_id=item['id'], fingerprint=fingerprint, status='skipped', results=[],
                            message='Insufficient material evidence, excluded item or grouped scope.', at=bom.now())
            plan = item['search_plan']
            filters = suppliers.SupplierSearch(revision=0, item_id=item['id'], location=plan['location'] or plan['state'] or plan['country'],
                company=plan['company'], currency=plan['currency'], max_unit_price=plan['max_unit_price'], include_unknown_prices=True)
            try:
                result = suppliers.discover(item, filters, settings['key'], settings['model'])
                result.update(item_id=item['id'], material_name=item['name'], fingerprint=fingerprint,
                    filters=filters.model_dump(exclude={'revision', 'item_id'}), filter_basis=plan['basis'],
                    status='complete' if result['results'] else 'unavailable', at=bom.now(), model=settings['model'], reused=False)
                atomic(target, result)
                return result
            except Exception as exc:
                return dict(item_id=item['id'], fingerprint=fingerprint, status='failed', results=[], at=bom.now(),
                            message=getattr(exc, 'detail', 'Supplier search failed. Retry explicitly.'))

        # Bounded sliding window: cancellation prevents more materials from starting.
        with ThreadPoolExecutor(max_workers=2) as pool:
            remaining = iter(items)
            pending = {}
            def submit_one():
                if event.is_set():
                    return
                item = next(remaining, None)
                if item:
                    pending[pool.submit(work, item)] = item
            submit_one(); submit_one()
            while pending:
                future = next(as_completed(pending))
                item = pending.pop(future)
                result = future.result()
                if result:
                    with self.lock:
                        current = bom.load(directory / 'bom.json', {})
                        if current.get('version') != snapshot['version'] or current.get('manifest') != bom.manifest(directory):
                            event.set()
                            raise ValueError('BOM or documents changed during supplier search. Completed source-specific results are cached.')
                        records[item['id']] = result
                        atomic(directory / 'supplier-results.json', records)
                    counts['done'] += 1
                    if result['status'] == 'failed': counts['failed'] += 1
                    if result['status'] == 'unavailable': counts['unavailable'] += 1
                    if result['status'] == 'skipped': counts['skipped'] += 1
                    if result.get('reused'): counts['reused'] += 1
                    elif result.get('usage'): usages.append(result['usage'])
                    update(**counts, usage=bom.usage_total(usages), message=f"{counts['done']} of {total} materials processed · {item['name'][:100]}")
                submit_one()
        if event.is_set():
            raise InterruptedError('Supplier batch stopped. Completed materials are saved; resume searches only missing or failed results.')
        update(status='complete', phase='complete', message='Supplier batch finished. Failed and unavailable items are visible in Needs attention.', **counts)

    def restore(self, pid, version):
        import re
        if not re.fullmatch(r'[a-f0-9]{32}', version):
            raise HTTPException(400, 'Invalid BOM version.')
        with self.lock:
            if self.busy(pid) or self.documents_busy(pid):
                raise HTTPException(409, 'Wait for the active Procurement job before restoring a version.')
            path = self.folder(pid) / 'ai-cache' / 'bom' / (version + '.json')
            if not path.exists():
                raise HTTPException(404, 'Saved BOM version not found.')
            value = bom.load(path, {})
            atomic(self.folder(pid) / 'bom.json', value)
            self.bump_revision(pid)
            return dict(version=version)

    def bump_revision(self, pid):
        path = self.folder(pid) / 'procurement.json'
        value = bom.load(path, dict(revision=0, reviews={}, manual=[], quotes=[], cart=[], orders=[], searches=[], audit=[]))
        value['revision'] += 1
        atomic(path, value)


def supplier_key(item, model):
    return bom.digest(dict(evidence=item['evidence_hash'], filters=item['search_plan'], model=model, version='suppliers-v2'))
