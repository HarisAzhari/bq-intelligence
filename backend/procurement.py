"""Evidence-backed local procurement. No supplier network requests or payments."""
import copy
import hashlib
import html
import json
import re
import uuid
from datetime import date, datetime, timezone
from typing import Literal
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, ConfigDict, Field

from backend import tender, bom
from backend.procurement_jobs import Jobs, supplier_key
from backend.ingestion import atomic
from backend.specs import find_codes
from backend.suppliers import SupplierSearch, discover as discover_suppliers, public_url

VERSION = 1
KINDS = ('source', 'spec', 'tender', 'cost')


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return tender.digest(value)


def number(value):
    """Accept unambiguous decimal notation; never guess units, currencies or ranges."""
    text = str(value if value is not None else '').strip()
    if not re.fullmatch(r'(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?', text):
        return None
    try:
        amount = Decimal(text.replace(',', ''))
        return float(amount) if amount.is_finite() and amount <= Decimal('1000000000000') else None
    except InvalidOperation:
        return None


def money(value):
    return float(Decimal(str(value)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))


def load(path, default):
    return json.loads(path.read_text(encoding='utf8')) if path.exists() else copy.deepcopy(default)


def identity(directory):
    return dict(files={f['kind']: f for f in bom.manifest(directory)})


def state(directory):
    saved = load(directory / 'procurement.json', dict(revision=0, reviews={}, manual=[], quotes=[], cart=[], orders=[], audit=[]))
    saved.setdefault('searches', [])
    snapshot = load(directory / 'bom.json', None)
    current = bom.manifest(directory)
    partial = load(directory / 'bom-progress.json', None)
    if not snapshot and partial and partial.get('manifest') == current and partial.get('prompt_version') == bom.VERSION:
        snapshot = partial
    stale = bool(snapshot and not bom.is_current(snapshot, current))
    items = copy.deepcopy(snapshot.get('items', [])) if snapshot else []
    for item in items:
        item['reviewed'] = False
        if stale:
            item.update(procurement_ready=False, search_ready=False, status='Outdated')
        elif snapshot.get('partial'):
            item.update(procurement_ready=False, search_ready=False, status='Partial · needs review')
    records = load(directory / 'supplier-results.json', {})
    return saved, dict(items=items, warnings=(snapshot or {}).get('warnings', []),
        documents={f['kind']: (snapshot or {}).get('documents', {}).get(f['kind'], {}).get('hash', '') for f in current},
        revision=saved['revision'], quotes=saved['quotes'], cart=saved['cart'], orders=saved['orders'], searches=saved['searches'],
        audit=saved['audit'][-100:], ordering_mode='purchase_order', live_supplier_connected=False,
        bom={k: v for k, v in (snapshot or {}).items() if k != 'items'}, bom_stale=stale,
        bom_history=load(directory / 'bom-history.json', []), supplier_results=records, manifest=current,
        legacy_materials_preserved=bool(saved['manual'] or saved['reviews']),
        estimate=dict(documents=len(current), pages=sum(f['pages'] or 0 for f in current),
            pdf_mb=round(sum(f['size'] for f in current)/1024/1024, 2),
            source_filename=current[0]['filename'] if current else '', max_workers=2,
            section_bytes=bom.MAX_SECTION_BYTES, max_requests=bom.MAX_SECTIONS))


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True, allow_inf_nan=False)


class Mutation(Strict):
    revision: int = Field(ge=0)


class Review(Mutation):
    evidence_hash: str
    name: str = Field(min_length=1, max_length=500)
    specification: str = Field(min_length=1, max_length=4000)
    brand: str = Field(default='', max_length=200)
    supplier: str = Field(default='', max_length=300)
    quantity: float | None = Field(default=None, gt=0, le=1e12)
    unit: str = Field(default='', max_length=30)
    category: str = Field(pattern='^(required|optional|provisional|excluded)$')
    budget: float | None = Field(default=None, ge=0, le=1e12)
    currency: str = Field(default='', pattern='^(?:[A-Z]{3})?$')
    reviewer: str = Field(min_length=1, max_length=100)
    resolution: str = Field(default='', max_length=4000)


class Manual(Mutation):
    name: str = Field(min_length=1, max_length=500)
    note: str = Field(min_length=1, max_length=2000)


class Quote(Mutation):
    item_id: str
    supplier: str = Field(min_length=1, max_length=300)
    contact: str = Field(default='', max_length=300)
    source_url: str = Field(default='', max_length=2000)
    reference: str = Field(min_length=1, max_length=200)
    product: str = Field(min_length=1, max_length=500)
    specification: str = Field(min_length=1, max_length=4000)
    unit: str = Field(min_length=1, max_length=30)
    currency: str = Field(pattern='^[A-Z]{3}$')
    unit_price: float = Field(ge=0, le=1e12)
    shipping: float = Field(default=0, ge=0, le=1e12)
    tax_percent: float = Field(default=0, ge=0, le=100)
    minimum_quantity: float = Field(default=1, gt=0, le=1e12)
    available_quantity: float | None = Field(default=None, ge=0, le=1e12)
    lead_days: int | None = Field(default=None, ge=0, le=3650)
    valid_until: date
    alternative: bool = False
    compliance_notes: str = Field(min_length=1, max_length=4000)
    verified_by: str = Field(min_length=1, max_length=100)


class Cart(Mutation):
    quote_id: str
    quantity: float = Field(gt=0, le=1e12)


class Order(Mutation):
    buyer: str = Field(min_length=1, max_length=300)
    delivery_address: str = Field(min_length=1, max_length=2000)
    requested_by: str = Field(min_length=1, max_length=100)
    required_date: date
    exception_reason: str = Field(default='', max_length=2000)


class Action(Mutation):
    action: str = Field(pattern='^(approve|issue|ordered|receive|cancel)$')
    actor: str = Field(min_length=1, max_length=100)
    reference: str = Field(default='', max_length=500)
    receipts: dict[str, float] = Field(default_factory=dict)


def find_item(view, item_id):
    item = next((i for i in view['items'] if i['id'] == item_id), None)
    if not item:
        raise HTTPException(404, 'Material no longer exists. Refresh Procurement.')
    return item


def valid_quote(view, quote):
    item = find_item(view, quote['item_id'])
    if not item.get('procurement_ready', False) or quote['review_hash'] != digest({k: item.get(k) for k in REVIEW_KEYS}):
        raise HTTPException(409, 'Material or sources changed. Review the material and record a current quote.')
    if item['category'] == 'excluded':
        raise HTTPException(400, 'Excluded materials cannot be ordered.')
    if quote['valid_until'] < date.today().isoformat():
        raise HTTPException(400, 'This quotation expired. Record a current quotation.')
    return item


REVIEW_KEYS = ('evidence_hash', 'name', 'specification', 'brand', 'quantity', 'unit', 'category', 'budget', 'currency', 'resolution')


def line_total(quote, quantity):
    subtotal = Decimal(str(quote['unit_price'])) * Decimal(str(quantity))
    return money((subtotal + Decimal(str(quote['shipping']))) * (1 + Decimal(str(quote['tax_percent'])) / 100))


def install(app, folder, read_project, lock, busy, ai_settings):
    router = APIRouter(prefix='/api/projects/{pid}/procurement')
    searches_active = set()
    jobs = Jobs(folder, lock, ai_settings, busy)

    def get(pid):
        read_project(pid)
        if busy(pid):
            raise HTTPException(409, 'Documents are being processed. Refresh Procurement when processing finishes.')
        saved, view = state(folder(pid))
        view['jobs'] = {kind: jobs.status(pid, kind) for kind in ('bom', 'suppliers')}
        model = ai_settings()['model']
        view['model'] = model
        for item in view['items']:
            result = view['supplier_results'].get(item['id'])
            if result:
                result['current'] = not view['bom_stale'] and result.get('fingerprint') == supplier_key(item, model)
        return saved, view

    def mutate(pid, body):
        saved, view = get(pid)
        if saved['revision'] != body.revision:
            raise HTTPException(409, 'Procurement changed in another view. Refresh before saving.')
        return saved, view

    def commit(pid, saved, action, actor=''):
        saved['revision'] += 1
        saved['audit'].append(dict(at=now(), action=action, actor=actor))
        atomic(folder(pid) / 'procurement.json', saved)
        return get(pid)[1]

    @router.get('')
    def overview(pid: str):
        with lock:
            return get(pid)[1]

    @router.get('/source/{kind}/{version}')
    def evidence(pid: str, kind: str, version: str):
        with lock:
            _, view = get(pid)
            if view['bom_stale'] or kind not in KINDS or view['documents'].get(kind) != version:
                raise HTTPException(409, 'This source has changed. Refresh Procurement for the current source.')
            return FileResponse(folder(pid) / f'{kind}.pdf', media_type='application/pdf')

    @router.post('/materials')
    @router.patch('/materials/{item_id}')
    def readonly_materials(pid: str):
        raise HTTPException(409, 'Materials are generated by AI. Regenerate the BOM to update them.')

    @router.post('/bom/generate', status_code=202)
    def generate_bom(pid: str, force: bool = False):
        read_project(pid)
        return jobs.start(pid, 'bom', force)

    @router.post('/suppliers/batch', status_code=202)
    def supplier_batch(pid: str, force: bool = False):
        read_project(pid)
        return jobs.start(pid, 'suppliers', force)

    @router.get('/jobs')
    def job_status(pid: str):
        read_project(pid)
        return {kind: jobs.status(pid, kind) for kind in ('bom', 'suppliers')}

    @router.post('/jobs/{kind}/cancel')
    def cancel_job(pid: str, kind: Literal['bom', 'suppliers']):
        read_project(pid)
        return jobs.cancel(pid, kind)

    @router.post('/bom/restore/{version}')
    def restore_bom(pid: str, version: str):
        read_project(pid)
        jobs.restore(pid, version)
        return get(pid)[1]

    @router.post('/quotes')
    def quote(pid: str, body: Quote):
        with lock:
            saved, view = mutate(pid, body)
            item = find_item(view, body.item_id)
            if not item.get('procurement_ready', False) or item['category'] == 'excluded':
                raise HTTPException(400, 'A current, evidence-supported material is needed before adding quotations.')
            if body.unit.lower() != item['unit'].lower():
                raise HTTPException(400, 'Quote units must match the reviewed material. Convert supplier packs explicitly before entering the quote.')
            if body.valid_until < date.today():
                raise HTTPException(400, 'Quotation validity must be today or later.')
            if body.source_url and not public_url(body.source_url):
                raise HTTPException(400, 'Use a public HTTP or HTTPS supplier product URL.')
            value = body.model_dump(mode='json', exclude={'revision'})
            value.update(id=uuid.uuid4().hex[:20], at=now(), review_hash=digest({k: item.get(k) for k in REVIEW_KEYS}))
            saved['quotes'].append(value)
            return commit(pid, saved, 'Recorded quote: ' + body.reference, body.verified_by)

    @router.post('/suppliers/search')
    def supplier_search_legacy(pid: str):
        raise HTTPException(409, 'Use the automatic supplier batch. Search filters now come from the AI BOM.')

    @router.post('/cart')
    def cart(pid: str, body: Cart):
        with lock:
            saved, view = mutate(pid, body)
            quote = next((q for q in saved['quotes'] if q['id'] == body.quote_id), None)
            if not quote:
                raise HTTPException(404, 'Quotation not found.')
            item = valid_quote(view, quote)
            if body.quantity < quote['minimum_quantity']:
                raise HTTPException(400, 'Quantity is below the supplier minimum.')
            if quote['available_quantity'] is not None and body.quantity > quote['available_quantity']:
                raise HTTPException(400, 'Quantity exceeds the recorded supplier availability.')
            saved['cart'] = [line for line in saved['cart'] if line['item_id'] != item['id']]
            saved['cart'].append(dict(item_id=item['id'], quote_id=quote['id'], quantity=body.quantity))
            return commit(pid, saved, 'Updated cart: ' + item['name'])

    @router.delete('/cart/{item_id}')
    def remove_cart(pid: str, item_id: str, revision: int):
        with lock:
            saved, _ = mutate(pid, Mutation(revision=revision))
            saved['cart'] = [line for line in saved['cart'] if line['item_id'] != item_id]
            return commit(pid, saved, 'Removed cart item')

    @router.post('/orders')
    def order(pid: str, body: Order):
        with lock:
            saved, view = mutate(pid, body)
            if not saved['cart']:
                raise HTTPException(400, 'Select supplier quotations and quantities first.')
            if body.required_date < date.today():
                raise HTTPException(400, 'Required delivery date cannot be in the past.')
            groups = {}
            for line in saved['cart']:
                quote = next(q for q in saved['quotes'] if q['id'] == line['quote_id'])
                item = valid_quote(view, quote)
                quantity = line['quantity']
                if quantity < quote['minimum_quantity'] or (quote['available_quantity'] is not None and quantity > quote['available_quantity']):
                    raise HTTPException(400, 'Cart quantity does not satisfy supplier availability or minimum.')
                total = line_total(quote, quantity)
                committed = sum(l['quantity'] for o in saved['orders'] if o['status'] != 'cancelled'
                                for l in o['lines'] if l['item']['id'] == item['id'])
                budget = item.get('budget')
                spent = sum(l['total'] for o in saved['orders'] if o['status'] != 'cancelled' and o['currency'] == quote['currency']
                            for l in o['lines'] if l['item']['id'] == item['id'])
                exceptions = []
                if committed + quantity > item['quantity']:
                    exceptions.append('Quantity exceeds remaining project requirement.')
                if item['category'] != 'required':
                    exceptions.append('Optional or provisional material selected.')
                if budget is None or item['currency'] != quote['currency']:
                    exceptions.append('Budget comparison unavailable (missing budget or different currency).')
                elif spent + total > budget:
                    exceptions.append('Committed orders plus this order exceed the material budget.')
                if quote['lead_days'] is None or quote['available_quantity'] is None:
                    exceptions.append('Delivery lead time or availability is unconfirmed.')
                elif quote['lead_days'] > (body.required_date - date.today()).days:
                    exceptions.append('Supplier lead time exceeds the requested delivery date.')
                if exceptions and not body.exception_reason:
                    raise HTTPException(400, 'Add an exception explanation: ' + ' '.join(exceptions))
                key = (quote['supplier'], quote['contact'], quote['currency'])
                groups.setdefault(key, []).append(dict(id=uuid.uuid4().hex[:12], item=copy.deepcopy(item),
                    quote=copy.deepcopy(quote), quantity=quantity, total=total, received=0, exceptions=exceptions))
            for (supplier, contact, currency), lines in groups.items():
                saved['orders'].append(dict(id='PO-' + uuid.uuid4().hex[:10].upper(), status='pending_approval',
                    supplier=supplier, contact=contact, currency=currency, lines=lines, total=money(sum(l['total'] for l in lines)),
                    **body.model_dump(mode='json', exclude={'revision'}), created_at=now(), events=[]))
            saved['cart'] = []
            return commit(pid, saved, 'Created purchase orders for approval', body.requested_by)

    @router.post('/orders/{order_id}/action')
    def action(pid: str, order_id: str, body: Action):
        with lock:
            saved, view = mutate(pid, body)
            order = next((o for o in saved['orders'] if o['id'] == order_id), None)
            if not order:
                raise HTTPException(404, 'Purchase order not found.')
            transitions = {'approve': ('pending_approval', 'approved'), 'issue': ('approved', 'po_ready'),
                           'ordered': ('po_ready', 'ordered')}
            if body.action in transitions:
                before, after = transitions[body.action]
                if order['status'] != before:
                    raise HTTPException(409, 'This action is not available for the current order status.')
                for line in order['lines']:
                    valid_quote(view, line['quote'])
                if body.action == 'ordered' and not body.reference:
                    raise HTTPException(400, 'Enter the supplier order acknowledgement or external order reference.')
                order['status'] = after
            elif body.action == 'receive':
                if order['status'] not in ('ordered', 'partially_delivered'):
                    raise HTTPException(409, 'Record a supplier order before receiving deliveries.')
                if not body.receipts or not body.reference:
                    raise HTTPException(400, 'Enter received quantities and a delivery note reference.')
                known = {line['id'] for line in order['lines']}
                if not set(body.receipts) <= known:
                    raise HTTPException(400, 'Unknown purchase order line.')
                for line in order['lines']:
                    amount = body.receipts.get(line['id'], 0)
                    if amount < 0 or amount + line['received'] > line['quantity']:
                        raise HTTPException(400, 'Received quantity cannot be negative or exceed the outstanding quantity.')
                    line['received'] += amount
                if not any(body.receipts.values()):
                    raise HTTPException(400, 'Enter at least one positive received quantity.')
                order['status'] = 'delivered' if all(l['received'] == l['quantity'] for l in order['lines']) else 'partially_delivered'
            elif body.action == 'cancel':
                if order['status'] not in ('pending_approval', 'approved', 'po_ready'):
                    raise HTTPException(409, 'Only an unplaced purchase order can be cancelled here.')
                order['status'] = 'cancelled'
            order['events'].append(dict(at=now(), action=body.action, actor=body.actor, reference=body.reference,
                                        receipts=body.receipts))
            return commit(pid, saved, body.action + ': ' + order_id, body.actor)

    @router.get('/rfq')
    def rfq(pid: str):
        with lock:
            _, view = get(pid)
            items = [i for i in view['items'] if i.get('procurement_ready', False) and i['category'] != 'excluded']
            if not items:
                raise HTTPException(400, 'Generate an evidence-supported BOM before preparing a quotation request.')
            rows = [[i['name'], i['specification'], i['quantity'], i['unit'], i['category']] for i in items]
            return document('Request for quotation', 'Prepared for manual sharing with suppliers. Please quote price, currency, tax, freight, minimum order, stock, lead time and quote validity.',
                            ['Material', 'Specification', 'Quantity', 'Unit', 'Classification'], rows, 'quotation-request.html')

    @router.get('/orders/{order_id}/document')
    def po_document(pid: str, order_id: str):
        with lock:
            saved, _ = get(pid)
            order = next((o for o in saved['orders'] if o['id'] == order_id), None)
            if not order:
                raise HTTPException(404, 'Purchase order not found.')
            if order['status'] not in ('po_ready', 'ordered', 'partially_delivered', 'delivered'):
                raise HTTPException(400, 'Approve and issue this purchase order before downloading it.')
            rows = [[l['item']['name'], l['quote']['product'], l['quote']['specification'], l['quantity'], l['item']['unit'],
                     l['quote']['unit_price'], l['quote']['shipping'], l['quote']['tax_percent'], l['total']] for l in order['lines']]
            description = (f"Buyer: {order['buyer']}\nSupplier: {order['supplier']}\nContact: {order['contact']}\n"
                f"Deliver to: {order['delivery_address']}\nRequired date: {order['required_date']}\n"
                f"Total: {order['currency']} {order['total']:.2f}\nStatus: {order['status']}\n"
                'Supplier submission is handled outside this app. This document does not confirm acceptance or payment.')
            return document(order['id'], description, ['Material', 'Quoted product', 'Specification', 'Quantity', 'Unit', 'Unit price', 'Freight', 'Tax %', 'Total'], rows, order['id'] + '.html')

    app.include_router(router)
    return jobs


def document(title, description, headings, rows, filename):
    escape = lambda value: html.escape(str(value))
    body = '<!doctype html><html lang="en"><meta charset="utf-8"><title>' + escape(title) + '</title>'
    body += '<style>body{font:14px system-ui;margin:40px;color:#172d2b}h1{font-size:30px}p{white-space:pre-wrap}table{width:100%;border-collapse:collapse}td,th{padding:10px;border:1px solid #bccbc8;text-align:left;white-space:pre-wrap}th{background:#edf3f1}@media print{body{margin:10mm}}</style>'
    body += '<h1>' + escape(title) + '</h1><p>' + escape(description) + '</p><table><thead><tr>'
    body += ''.join('<th>' + escape(h) + '</th>' for h in headings) + '</tr></thead><tbody>'
    body += ''.join('<tr>' + ''.join('<td>' + escape(v) + '</td>' for v in row) + '</tr>' for row in rows)
    body += '</tbody></table></html>'
    return HTMLResponse(body, headers={'Content-Disposition': f'attachment; filename="{filename}"'})
