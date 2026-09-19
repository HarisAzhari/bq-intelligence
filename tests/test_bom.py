"""Focused offline checks for generic BOQ extraction; no live provider calls."""
import copy
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import pymupdf as fitz
from backend import bom, procurement
from backend.ingestion import atomic
import bom_fixture as fixture


class BOMTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        (self.directory / 'tender.pdf').write_bytes(fixture.pdf())
        atomic(self.directory / 'tender.json', dict(filename='Any BOQ.pdf', page_count=1))
        guard = patch.object(bom.httpx, 'post', side_effect=AssertionError('No live AI requests in tests'))
        guard.start()
        self.addCleanup(guard.stop)

    def plan(self, count):
        records = [bom.source_record(i, 0, fixture.TEXT) for i in range(1, count + 1)]
        documents = dict(tender=dict(filename='Any BOQ.pdf', hash='fixture',
            pages=[dict(page=i, text=fixture.TEXT) for i in range(1, count + 1)],
            records={r['id']: r for r in records}))
        sections = [dict(number=i, records=[r], content=bom.content_for([r]))
                    for i, r in enumerate(records, 1)]
        return bom.manifest(self.directory), documents, dict(sections=sections, warnings=[], skipped_pages=[])

    def answer(self, content):
        record = json.loads(content[0]['text'])['records'][0]
        bill = fixture.bill()
        item = bill['materials'][0]
        item['boq_page'] = record['page']
        item['sources'] = [dict(source_id=record['source_id'], fields=item['sources'][0]['fields'])]
        return json.dumps(bill), dict(total_tokens=100, cost=.005)

    def generate(self, **kwargs):
        return bom.generate(self.directory, 'offline-key', 'test-model',
                            kwargs.get('update', lambda **x: None), lambda: False)

    def test_different_column_orders_and_plain_text_use_source_ids(self):
        with fitz.open() as doc:
            layouts = [
                (['Item', 'Description', 'Qty', 'Unit'], ['A1', 'Porcelain tile 600 x 600 mm', '12', 'm2']),
                (['Quantity', 'Description', 'UOM', 'Ref'], ['15', 'Porcelain tile 300 x 300 mm', 'm2', 'B1'])]
            for headers, values in layouts:
                page = doc.new_page()
                xs = [30, 100, 340, 410, 480]
                for x in xs:
                    page.draw_line((x, 20), (x, 80))
                for y in [20, 50, 80]:
                    page.draw_line((30, y), (480, y))
                for row, y in [(headers, 38), (values, 68)]:
                    for x, value in zip(xs, row):
                        page.insert_text((x + 3, y), value, fontsize=9)
                page.insert_text((30, 115), 'Unnumbered supporting description')
            (self.directory / 'tender.pdf').write_bytes(doc.tobytes())
        (self.directory / 'source.pdf').write_bytes(b'not a PDF')
        (self.directory / 'spec.pdf').write_bytes(b'not a PDF')
        files, docs, plan = bom.prepare(self.directory, lambda **x: None, lambda: False)
        self.assertEqual([f['kind'] for f in files], ['tender'])
        rows = [r for r in docs['tender']['records'].values() if r['cells'].get('quantity')]
        self.assertEqual([r['cells']['quantity'] for r in rows], ['12', '15'])
        sent = [r for section in plan['sections'] for r in json.loads(section['content'][0]['text'])['records']]
        self.assertTrue(all(r.get('source_id') for r in sent))
        self.assertTrue(any('Unnumbered supporting' in r.get('text', '') for r in sent))
        self.assertEqual(len({r['source_id'] for r in sent}), len(sent))
        self.assertNotIn('file_data', json.dumps(sent))

    def test_invalid_reference_flags_one_item_without_failing_section(self):
        files, docs, plan = self.plan(1)
        raw, usage = self.answer(plan['sections'][0]['content'])
        bill = json.loads(raw)
        invalid = copy.deepcopy(bill['materials'][0])
        invalid['name'] = 'Unsupported material'
        invalid['sources'][0]['source_id'] = 'another-section'
        bill['materials'].append(invalid)
        checked = bom.check_section(bill, plan['sections'][0])
        result = bom.validate_bill(checked, docs)
        self.assertEqual(len(result['items']), 2)
        self.assertTrue(result['items'][0]['procurement_ready'])
        self.assertIsNone(result['items'][1]['quantity'])
        self.assertFalse(result['items'][1]['search_ready'])
        self.assertIn('Source ID', ' '.join(result['items'][1]['conflicts']))

    def test_quantity_comes_from_quantity_column_not_dimension_or_rate(self):
        files, docs, plan = self.plan(1)
        record = plan['sections'][0]['records'][0]
        record['cells'] = dict(description='600 x 600 mm tile', quantity='12', unit='m2', rate='600')
        raw, usage = self.answer(plan['sections'][0]['content'])
        value = json.loads(raw)
        value['materials'][0]['quantity'] = 600
        result = bom.validate_bill(bom.check_section(value, plan['sections'][0]), docs)
        self.assertIsNone(result['items'][0]['quantity'])
        value['materials'][0]['quantity'] = 12
        result = bom.validate_bill(bom.check_section(value, plan['sections'][0]), docs)
        self.assertEqual(result['items'][0]['quantity'], 12)
        self.assertEqual(bom.printed_number('1.250,50'), 1250.5)
        self.assertIsNone(bom.numeric_evidence('quantity', '600 x 600 mm; total 600', {}))

    def test_split_is_bounded_and_does_not_repeat_records(self):
        records = [bom.source_record(i, 0, 'Unnumbered material ' + 'details ' * 10) for i in range(1, 8)]
        with patch.object(bom, 'MAX_SECTION_BYTES', 450):
            sections = bom.split_sections(records)
            sent = [r['id'] for section in sections for r in section['records']]
            self.assertEqual(sent, [r['id'] for r in records])
            self.assertTrue(all(bom.section_size(section['records']) <= 450 for section in sections))
            with patch.object(bom, 'MAX_SECTIONS', 1):
                with self.assertRaisesRegex(ValueError, 'safety limit'):
                    bom.split_sections(records)

    def test_two_workers_keep_source_order_and_send_each_section_once(self):
        gate, lock = threading.Barrier(2), threading.Lock()
        active, peak, calls = 0, 0, []
        def provider(content, *args):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                calls.append(json.loads(content[0]['text'])['records'][0]['page'])
            gate.wait(3)
            result = self.answer(content)
            with lock:
                active -= 1
            return result
        with patch.object(bom, 'prepare', return_value=self.plan(4)), patch.object(bom, 'request_ai', side_effect=provider):
            result, cached = self.generate()
        self.assertEqual(peak, 2)
        self.assertEqual(sorted(calls), [1, 2, 3, 4])
        self.assertEqual([i['boq_page'] for i in result['items']], [1, 2, 3, 4])
        self.assertEqual(result['usage']['requests'], 4)

    def test_response_saved_before_validation_and_replayed_without_charge(self):
        prepared = self.plan(1)
        with patch.object(bom, 'prepare', return_value=prepared):
            with patch.object(bom, 'request_ai', side_effect=lambda content, *args: self.answer(content)) as provider:
                with patch.object(bom, 'check_section', side_effect=ValueError('Local validation unavailable')):
                    with self.assertRaisesRegex(ValueError, 'Local validation'):
                        self.generate()
                self.assertEqual(provider.call_count, 1)
            files = list((self.directory / 'ai-cache' / 'bom').glob('*.response.json'))
            self.assertEqual(len(files), 1)
            self.assertIn('raw', bom.load(files[0], {}))
            with patch.object(bom, 'request_ai') as provider:
                result, cached = self.generate()
                provider.assert_not_called()
            self.assertEqual(result['usage']['requests'], 0)
            self.assertEqual(len(result['items']), 1)

    def test_failed_request_retains_partial_materials_and_resumes_only_missing(self):
        prepared, gate = self.plan(2), threading.Barrier(2)
        def fail(content, *args):
            page = json.loads(content[0]['text'])['records'][0]['page']
            gate.wait(3)
            if page == 2:
                raise ValueError('HTTP 400')
            return self.answer(content)
        with patch.object(bom, 'prepare', return_value=prepared):
            with patch.object(bom, 'request_ai', side_effect=fail):
                with self.assertRaisesRegex(ValueError, 'Section 2'):
                    self.generate()
            view = procurement.state(self.directory)[1]
            self.assertTrue(view['bom']['partial'])
            self.assertEqual(len(view['items']), 1)
            self.assertFalse(view['items'][0]['procurement_ready'])
            with patch.object(bom, 'request_ai', side_effect=lambda content, *args: self.answer(content)) as provider:
                result, cached = self.generate()
                self.assertEqual(provider.call_count, 1)
            self.assertEqual(result['reused_sections'], 1)

    def test_compatible_legacy_cache_is_reused_without_overwriting_it(self):
        files, docs, plan = self.plan(2)
        plan['legacy_key'] = 'old-key'
        plan['sections'][0]['legacy_number'] = 1
        path = self.directory / 'ai-cache' / 'bom' / 'old-key-part-1.json'
        path.parent.mkdir(parents=True)
        atomic(path, dict(bill=fixture.bill(), usage=dict(total_tokens=100, cost=.005), at='saved'))
        before = path.read_bytes()
        with patch.object(bom, 'prepare', return_value=(files, docs, plan)), patch.object(bom, 'request_ai', side_effect=lambda content, *args: self.answer(content)) as provider:
            result, cached = self.generate()
            self.assertEqual(provider.call_count, 1)
        self.assertEqual(result['reused_sections'], 1)
        self.assertEqual(path.read_bytes(), before)

    def test_duplicate_conflict_is_flagged_instead_of_stopping_all_results(self):
        files, docs, plan = self.plan(1)
        value = fixture.bill()
        duplicate = copy.deepcopy(value['materials'][0])
        duplicate['quantity'] = 999
        value['materials'].append(duplicate)
        result = bom.validate_bill(value, docs)
        self.assertEqual(len(result['items']), 1)
        self.assertIsNone(result['items'][0]['quantity'])
        self.assertFalse(result['items'][0]['procurement_ready'])

    def test_request_uses_ids_and_reports_provider_error_without_exposing_key(self):
        response = httpx.Response(400, json=dict(error=dict(message='Context exceeded sk-or-secret')),
                                 request=httpx.Request('POST', 'https://openrouter.ai/api/v1/chat/completions'))
        content = self.plan(1)[2]['sections'][0]['content']
        with patch.object(bom.httpx, 'post', return_value=response) as post:
            with self.assertRaisesRegex(ValueError, 'Context exceeded') as error:
                bom.request_ai(content, 'sk-or-secret', 'model')
        payload = post.call_args.kwargs['json']
        self.assertNotIn('plugins', payload)
        schema = payload['response_format']['json_schema']['schema']
        self.assertIn('SourceReference', schema['$defs'])
        self.assertNotIn('quote', schema['$defs']['SourceReference']['properties'])
        self.assertNotIn('sk-or-secret', str(error.exception))

    def test_missing_or_scanned_document_stops_before_ai(self):
        (self.directory / 'tender.pdf').unlink()
        with patch.object(bom, 'request_ai') as provider:
            with self.assertRaisesRegex(ValueError, 'BOQ PDF'):
                self.generate()
            with fitz.open() as doc:
                page = doc.new_page()
                pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 1, 1), False)
                page.insert_image(fitz.Rect(0, 0, 100, 100), stream=pix.tobytes('png'))
                (self.directory / 'tender.pdf').write_bytes(doc.tobytes())
            with self.assertRaisesRegex(ValueError, 'OCR'):
                self.generate()
            provider.assert_not_called()


if __name__ == '__main__':
    unittest.main()
