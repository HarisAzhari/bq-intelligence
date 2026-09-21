"""Offline regression tests for the cost breakdown PDF. No provider request is ever made:
every answer is a stub, and all PDFs and project data live in temporary directories."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pymupdf as fitz
from fastapi.testclient import TestClient

from backend import chat, main, specs


def spec_fixture():
    return dict(hash='spec-v1', version=specs.VERSION, filename='spec.pdf', page_count=1, uploaded=1,
                item_count=1, blank_pages=0, pages=[],
                items=[dict(code='FF-06', title='Porcelain floor tile 600 x 600 mm', brand='', pages=[1], starts=[1])])


def cost_pdf(rate='12.50'):
    """A one-page priced document, written with the same wording a bill of quantities uses."""
    with fitz.open() as doc:
        page = doc.new_page(width=800, height=500)
        for i, line in enumerate(['BILL OF QUANTITIES - SECTION 3 FINISHES',
                                  'Item 3.2  FF-06 Porcelain floor tile 600 x 600 mm',
                                  'Unit m2   Quantity 850   Rate 12.50   Amount 10,625.00'.replace('12.50', rate),
                                  'Rate includes bedding, grouting and all necessary cutting.']):
            page.insert_text((30, 60 + i * 30), line, fontsize=11)
        return doc.tobytes()


def drawing_pdf():
    with fitz.open() as doc:
        doc.new_page(width=800, height=500).insert_text((30, 60), 'FF-06 Porcelain floor tile', fontsize=12)
        return doc.tobytes()


class IndexTests(unittest.TestCase):
    def test_priced_page_is_indexed_and_selected_by_its_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'cost.pdf'
            path.write_bytes(cost_pdf())
            index = specs.index_spec(path, 'cost breakdown.pdf', 'cost breakdown')
            self.assertEqual(index['page_count'], 1)
            self.assertEqual(index['blank_pages'], 0)
            # Item badges need a coded layout; a code printed in running text still ranks its page.
            self.assertEqual(index['pages'][0]['mentions'], ['FF-06'])
            selected = specs.select_spec(index, path, 'FF-06 floor tile', 'What is the rate for FF-06?')
            self.assertEqual([e['page'] for e in selected['excerpts']], [1])
            self.assertIn('10,625.00', selected['excerpts'][0]['text'])

    def test_page_limit_message_names_the_document(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'cost.pdf'
            path.write_bytes(cost_pdf())
            with patch.object(specs, 'MAX_PAGES', 0), self.assertRaises(ValueError) as caught:
                specs.index_spec(path, 'cost.pdf', 'cost breakdown')
            self.assertIn('cost breakdown', str(caught.exception))


class ApiTests(unittest.TestCase):
    def setUp(self):
        auth = patch.object(main.accounts, 'identity', return_value={'id':'fixture-user','role':'user'})
        auth.start(); self.addCleanup(auth.stop)
        ownership = patch.object(main.accounts, 'can_access_project', return_value=True)
        ownership.start(); self.addCleanup(ownership.stop)
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.pid = 'aabbccddeeff'; self.folder = self.root/self.pid
        self.folder.mkdir()
        self.prefix = f'/api/projects/{self.pid}'
        patcher = patch.object(main, 'DATA', self.root); patcher.start(); self.addCleanup(patcher.stop)
        main.SPEC_CACHE.clear()
        self.folder.joinpath('source.pdf').write_bytes(drawing_pdf())
        main.atomic(self.folder/'index.json', dict(id=self.pid, page_count=1,
                                                   pages=[dict(page=1, text='FF-06 Porcelain floor tile')]))
        main.atomic(self.folder/'spec.json', spec_fixture())
        self.client = TestClient(main.app); self.addCleanup(self.client.close)
        selected = dict(path='', filename='doc.pdf', page_count=1, drawing_codes=[], codes_in_question=['FF-06'],
                        index=[], index_truncated=False, excerpts=[], image_pages=[])
        for obj, name, value in [(main, 'ready', lambda: True), (main, 'current_model', lambda: 'test-model'),
                                 (main, 'select_spec', lambda *a, **kw: selected)]:
            helper = patch.object(obj, name, value); helper.start(); self.addCleanup(helper.stop)
        helper = patch.dict(os.environ, {'OPENROUTER_API_KEY': 'offline-test'}); helper.start(); self.addCleanup(helper.stop)
        # No paid call is ever made: every answer comes from this stub.
        self.ask = patch.object(main, 'ask_sheet', return_value=dict(answer='Rate 12.50 per m2 [Cost p.1]', sources=[],
            spec_refs=[], cost_refs=[dict(page=1, code='FF-06', title='Porcelain floor tile', quote='12.50',
                                          boxes=[[.1, .1, .5, .2]], verified=True)],
            cost_pages=[1], usage={'total_tokens': 10}))
        self.mock_ask = self.ask.start(); self.addCleanup(self.ask.stop)

    def upload(self, data=None):
        return self.client.post(self.prefix+'/cost',
                                files={'file': ('cost breakdown.pdf', data or cost_pdf(), 'application/pdf')})

    def question(self, **extra):
        return self.client.post(self.prefix+'/pages/1/chat', json=dict(question='What is the rate for FF-06?', **extra))

    def test_upload_lists_and_serves_the_document(self):
        summary = self.upload()
        self.assertEqual(summary.status_code, 200, summary.text)
        self.assertEqual(summary.json()['page_count'], 1)
        self.assertEqual(summary.json()['filename'], 'cost breakdown.pdf')
        self.assertEqual(self.client.get(self.prefix+'/cost').json()['cost']['page_count'], 1)
        self.assertEqual(self.client.get(self.prefix).json()['cost']['page_count'], 1)
        self.assertEqual(self.client.get(self.prefix+'/cost/pdf').headers['content-type'], 'application/pdf')
        self.assertEqual(self.client.get(self.prefix+'/cost/pages/1/image').headers['content-type'], 'image/png')
        self.assertEqual(self.client.get(self.prefix+'/cost/pages/9/image').status_code, 404)

    def test_specification_and_cost_are_stored_separately(self):
        self.upload()
        self.assertTrue((self.folder/'cost.pdf').exists())
        self.assertEqual(self.client.get(self.prefix).json()['spec']['filename'], 'spec.pdf')
        self.assertEqual(self.client.delete(self.prefix+'/cost').status_code, 204)
        self.assertIsNone(self.client.get(self.prefix).json()['cost'])
        self.assertIsNotNone(self.client.get(self.prefix).json()['spec'])

    def test_invalid_upload_is_rejected(self):
        self.assertEqual(self.client.post(self.prefix+'/cost',
            files={'file': ('notes.txt', b'hello', 'text/plain')}).status_code, 400)
        self.assertEqual(self.client.post(self.prefix+'/cost',
            files={'file': ('cost.pdf', b'not a PDF', 'application/pdf')}).status_code, 400)

    def test_every_question_reads_the_cost_breakdown(self):
        self.question()
        self.assertNotIn('cost', self.mock_ask.call_args.kwargs)
        self.upload()
        answer = self.question(fresh=True).json()
        self.assertIn('cost', self.mock_ask.call_args.kwargs)
        self.assertIn('spec', self.mock_ask.call_args.kwargs)
        turn = self.client.get(self.prefix+'/chats').json()['1']['turns'][-1]
        self.assertEqual(turn['cost_refs'][0]['page'], 1)
        self.assertEqual(turn['cost_pages'], [1])
        self.assertTrue(turn['cost_hash'])
        self.assertFalse(answer['cached'])

    def test_saved_answers_follow_the_linked_cost_breakdown(self):
        self.upload()
        self.assertFalse(self.question().json()['cached'])
        self.assertTrue(self.question().json()['cached'])
        self.assertEqual(self.mock_ask.call_count, 1)
        # A different priced document is different evidence: the saved answer is offered, not reused.
        self.upload(cost_pdf(rate='19.90'))
        self.assertTrue(self.question().json()['needs_choice'])
        self.assertEqual(self.mock_ask.call_count, 1)
        self.assertFalse(self.question(fresh=True).json()['cached'])
        self.assertEqual(self.mock_ask.call_count, 2)
        # Removing it also changes the evidence, and never discards the conversation.
        self.client.delete(self.prefix+'/cost')
        self.assertTrue(self.question().json()['needs_choice'])
        self.assertTrue(self.client.get(self.prefix+'/chats').json()['1']['turns'])

    def test_uploads_wait_for_a_running_answer(self):
        main.CHAT_ACTIVE.add((self.pid, 1))
        try:
            self.assertEqual(self.upload().status_code, 409)
            self.assertEqual(self.client.delete(self.prefix+'/cost').status_code, 409)
        finally:
            main.CHAT_ACTIVE.discard((self.pid, 1))
        self.assertEqual(self.upload().status_code, 200)


class AssemblyTests(unittest.TestCase):
    """The request that would be sent to the provider, built and checked offline."""

    def test_cost_pages_travel_with_the_question_and_refs_are_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'cost.pdf'
            path.write_bytes(cost_pdf())
            index = specs.index_spec(path, 'cost.pdf', 'cost breakdown')
            selected = specs.select_spec(index, path, 'FF-06', 'What is the rate for FF-06?')
            answer = json.dumps(dict(answer='The rate is 12.50 per m2 [Cost p.1]', sources=[],
                                     cost_refs=[dict(page=1, code='FF-06', title='Floor tile', quote='Rate'),
                                                dict(page=44, quote='off the end')]))
            response = {'choices': [{'message': {'content': answer}, 'finish_reason': 'stop'}], 'usage': {}}
            with patch.object(chat, 'render_inputs', return_value=[]), patch.object(chat.metering, 'post') as request:
                request.return_value.json.return_value = response
                result = chat.ask_sheet(path, 1, 'FF-06', chat.Question(question='rate?'), 'offline', 'test',
                                        cost=dict(selected, path=str(path)))
            sent = json.loads(request.call_args.kwargs['json']['messages'][-1]['content'][0]['text'])
            self.assertIn('cost_breakdown', sent)
            self.assertIn('10,625.00', sent['cost_breakdown']['excerpts'][0]['text'])
            self.assertIn('COST BREAKDOWN', request.call_args.kwargs['json']['messages'][0]['content'])
            self.assertEqual(len(result['cost_refs']), 1)
            self.assertTrue(result['cost_refs'][0]['verified'])
            self.assertEqual(result['cost_pages'], [1])
            self.assertEqual(result['spec_refs'], [])


if __name__ == '__main__':
    unittest.main()
