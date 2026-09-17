"""Offline regression tests. All PDFs and project data live in temporary directories."""
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pymupdf as fitz
from fastapi.testclient import TestClient

from backend import tender, main, chat


def spec_fixture():
    return dict(hash='spec-v1', version=3, filename='spec.pdf', page_count=1, uploaded=1, item_count=2, blank_pages=0,
                items=[dict(code='FF-06', title='Porcelain floor tile 600 x 600 mm', brand='', pages=[1], starts=[1]),
                       dict(code='WF-01', title='Ceramic wall tile 300 x 300 mm', brand='', pages=[1], starts=[1])])


def row_fixture(description='Porcelain floor tile 600 x 600 mm', codes=None):
    return dict(id='r1', page=1, text=description+'\n850\nm2', box=[.1,.1,.8,.2],
                fields=dict(description=description, quantity='850', unit='m2'), codes=['FF-06'] if codes is None else codes,
                structured=True, extraction_review=False)


def index_fixture():
    return dict(version=1, hash='tender-v1', filename='tender.pdf', page_count=1, uploaded=1,
                rows=[row_fixture()], pages=[], warnings=[], decisions={})


def pdf_bytes(table=False, description='FF-06 Porcelain floor tile 600 x 600 mm'):
    with fitz.open() as doc:
        page=doc.new_page(width=800,height=500)
        if table:
            xs=[30,90,450,510,580,660,770]; ys=[50,90,150]
            for x in xs: page.draw_line((x,50),(x,150))
            for y in ys: page.draw_line((30,y),(770,y))
            for i,value in enumerate(['Item','Description','Unit','Quantity','Rate','Amount']):
                page.insert_text((xs[i]+4,74),value,fontsize=10)
            for i,value in enumerate(['3.2',description,'m2','850','12.50','10,625.00']):
                page.insert_text((xs[i]+4,120),value,fontsize=10)
        else:
            page.insert_text((30,60),description,fontsize=12)
        return doc.tobytes()


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.spec=spec_fixture()

    def test_exact_compatible_auto_confirms(self):
        match=tender.match_row(row_fixture(),self.spec,{})
        self.assertEqual(match['status'],'confirmed')
        self.assertEqual(match['codes'],['FF-06'])

    def test_unit_price_and_unit_rate_are_rates(self):
        self.assertEqual(tender.header_field('Unit Rate (RM)'), 'rate')
        self.assertEqual(tender.header_field('Unit Price'), 'rate')

    def test_same_code_different_application_is_conflict(self):
        self.assertEqual(tender.match_row(row_fixture('Porcelain wall tile 600 x 600 mm'),self.spec,{})['status'],'conflict')

    def test_same_code_different_dimensions_is_conflict(self):
        match=tender.match_row(row_fixture('Porcelain floor tile 300 x 300 mm'),self.spec,{})
        self.assertEqual(match['status'],'conflict')
        self.assertEqual(match['codes'],[])

    def test_same_code_unrelated_description_is_conflict(self):
        self.assertEqual(tender.match_row(row_fixture('Stainless steel railing'),self.spec,{})['status'],'conflict')

    def test_description_only_never_auto_confirms(self):
        result=tender.match_row(row_fixture(codes=[]),self.spec,{})
        self.assertEqual(result['status'],'suggested')
        self.assertEqual(result['codes'],[])
        self.assertEqual(result['candidates'][0]['code'],'FF-06')

    def test_multiple_printed_codes_require_review(self):
        self.assertEqual(tender.match_row(row_fixture(codes=['FF-06','WF-01']),self.spec,{})['status'],'ambiguous')

    def test_unstructured_code_needs_review(self):
        row=row_fixture();row['extraction_review']=True;row['structured']=False
        self.assertEqual(tender.match_row(row,self.spec,{})['status'],'suggested')

    def test_manual_link_is_versioned_and_can_be_unmatched(self):
        decision={'r1':dict(action='confirm',codes=['WF-01'],spec=tender.spec_identity(self.spec))}
        self.assertEqual(tender.match_row(row_fixture(),self.spec,decision)['codes'],['WF-01'])
        changed=dict(self.spec,hash='spec-v2')
        self.assertEqual(tender.match_row(row_fixture(),changed,decision)['codes'],[])
        decision['r1']['action']='unmatched'
        self.assertEqual(tender.match_row(row_fixture(),self.spec,decision)['status'],'unmatched')

    def test_context_changes_for_file_spec_or_decision(self):
        index=index_fixture();original=tender.context_hash(index,self.spec)
        for key in ['hash','version']:
            modified=copy.deepcopy(index);modified[key]='different'
            self.assertNotEqual(original,tender.context_hash(modified,self.spec))
        index['decisions']['r1']={'action':'unmatched','codes':[],'spec':tender.spec_identity(self.spec)}
        self.assertNotEqual(original,tender.context_hash(index,self.spec))
        self.assertNotEqual(original,tender.context_hash(index_fixture(),dict(self.spec,hash='new')))

    def test_selected_rows_keep_uncertainty(self):
        index=index_fixture();index['rows'][0]['codes']=[]
        result=tender.select_tender(index,self.spec,'FF-06','What porcelain floor tile is in the tender?')
        self.assertEqual(result['rows'][0]['link']['status'],'suggested')
        self.assertEqual(result['rows'][0]['link']['codes'],[])

    def test_reference_must_be_in_supplied_rows(self):
        selection=tender.select_tender(index_fixture(),self.spec,'FF-06','FF-06')
        refs=tender.locate_tender_refs(selection,[{'row_id':'r999'}, {'row_id':'r1','quote':'850'}, {'row_id':'r1','quote':'wrong'}])
        self.assertEqual(len(refs),1)
        self.assertTrue(refs[0]['verified'])
        self.assertEqual(refs[0]['fields']['quantity'],'850')

    def test_table_extraction_preserves_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'table.pdf';path.write_bytes(pdf_bytes(table=True))
            result=tender.index_tender(path,'table.pdf')
        self.assertEqual(len(result['rows']),1)
        row=result['rows'][0]
        self.assertEqual(row['fields']['quantity'],'850')
        self.assertEqual(row['fields']['rate'],'12.50')
        self.assertEqual(row['fields']['amount'],'10,625.00')
        self.assertEqual(row['codes'],['FF-06'])
        self.assertTrue(row['structured'])

    def test_unstructured_does_not_guess_commercial_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'text.pdf';path.write_bytes(pdf_bytes())
            result=tender.index_tender(path,'text.pdf')
        self.assertTrue(result['warnings'])
        self.assertFalse(result['rows'][0]['structured'])
        self.assertNotIn('quantity',result['rows'][0]['fields'])

    def test_scan_is_reported_without_invented_rows(self):
        with tempfile.TemporaryDirectory() as tmp, fitz.open() as doc:
            doc.new_page();path=Path(tmp)/'blank.pdf';doc.save(path)
            result=tender.index_tender(path,'blank.pdf')
        self.assertEqual(result['rows'],[])
        self.assertIn('no readable text',result['warnings'][0])


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.pid='aabbccddeeff';self.folder=self.root/self.pid;self.folder.mkdir()
        self.prefix=f'/api/projects/{self.pid}'
        self.patch=patch.object(main,'DATA',self.root);self.patch.start();self.addCleanup(self.patch.stop)
        main.SPEC_CACHE.clear()
        self.folder.joinpath('source.pdf').write_bytes(pdf_bytes())
        self.folder.joinpath('tender.pdf').write_bytes(pdf_bytes(table=True))
        main.atomic(self.folder/'index.json',dict(id=self.pid,page_count=1,pages=[dict(page=1,text='FF-06 Porcelain floor tile')]))
        main.atomic(self.folder/'spec.json',spec_fixture())
        main.atomic(self.folder/'tender.json',index_fixture())
        self.client=TestClient(main.app)
        self.addCleanup(self.client.close)
        selected=dict(path='',filename='spec.pdf',page_count=1,drawing_codes=[],codes_in_question=['FF-06'],
                      index=[],index_truncated=False,excerpts=[],image_pages=[])
        for obj,name,value in [(main,'ready',lambda:True),(main,'current_model',lambda:'test-model'),
                               (main,'select_spec',lambda *a,**kw:selected)]:
            helper=patch.object(obj,name,value);helper.start();self.addCleanup(helper.stop)
        helper=patch.dict(os.environ,{'OPENROUTER_API_KEY':'offline-test'});helper.start();self.addCleanup(helper.stop)
        self.ask=patch.object(main,'ask_sheet',return_value=dict(answer='Tender quantity 850 m2 [Tender r1]',sources=[],
             spec_refs=[],tender_refs=[dict(row_id='r1',page=1,box=[.1,.1,.8,.2],quote='850',verified=True)],
             tender_rows=['r1'],usage={'total_tokens':10}))
        self.mock_ask=self.ask.start();self.addCleanup(self.ask.stop)

    def ask(self,**extra):
        return self.client.post(self.prefix+'/pages/1/chat',json=dict(question='What is FF-06?',**extra))

    def test_review_and_stale_write_guard(self):
        state=self.client.get(self.prefix+'/tender').json()
        self.assertEqual(state['rows'][0]['link']['status'],'confirmed')
        body=dict(action='unmatched',codes=[],context_hash=state['tender']['context_hash'])
        self.assertEqual(self.client.patch(self.prefix+'/tender/rows/r1',json=body).status_code,200)
        self.assertEqual(self.client.patch(self.prefix+'/tender/rows/r1',json=body).status_code,409)
        self.assertEqual(self.client.get(self.prefix+'/tender').json()['rows'][0]['link']['status'],'unmatched')

    def test_unknown_material_rejected(self):
        context=self.client.get(self.prefix+'/tender').json()['tender']['context_hash']
        result=self.client.patch(self.prefix+'/tender/rows/r1',json=dict(action='confirm',codes=['ZZ-99'],context_hash=context))
        self.assertEqual(result.status_code,400)

    def test_chat_reuses_only_current_relationships(self):
        first=self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'}).json()
        self.assertFalse(first['cached']);self.assertIn('tender',self.mock_ask.call_args.kwargs)
        repeat=self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'}).json()
        self.assertTrue(repeat['cached']);self.assertEqual(self.mock_ask.call_count,1)
        state=self.client.get(self.prefix+'/tender').json()
        result=self.client.patch(self.prefix+'/tender/rows/r1',json=dict(action='unmatched',codes=[],context_hash=state['tender']['context_hash']))
        self.assertEqual(result.status_code,200)
        changed=self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'}).json()
        self.assertTrue(changed['needs_choice']);self.assertEqual(self.mock_ask.call_count,1)
        fresh=self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?','fresh':True}).json()
        self.assertFalse(fresh['cached']);self.assertEqual(self.mock_ask.call_count,2)

    def test_remove_invalidates_and_preserves_history(self):
        self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'})
        self.assertEqual(self.client.delete(self.prefix+'/tender').status_code,204)
        result=self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'}).json()
        self.assertTrue(result['needs_choice'])
        self.assertTrue(self.client.get(self.prefix+'/chats').json()['1']['turns'])

    def test_replacement_invalidates(self):
        self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'})
        response=self.client.post(self.prefix+'/tender',files={'file':('new.pdf',pdf_bytes(table=True),'application/pdf')})
        self.assertEqual(response.status_code,200,response.text)
        result=self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'}).json()
        self.assertTrue(result['needs_choice'])

    def test_upload_validation_and_active_guards(self):
        self.assertEqual(self.client.post(self.prefix+'/tender',files={'file':('bad.pdf',b'not a PDF','application/pdf')}).status_code,400)
        main.CHAT_ACTIVE.add((self.pid,1))
        try:
            self.assertEqual(self.client.delete(self.prefix+'/tender').status_code,409)
        finally:
            main.CHAT_ACTIVE.discard((self.pid,1))
        self.assertEqual(self.client.get(self.prefix+'/tender/pages/1/image?version=old').status_code,409)
        self.assertEqual(self.client.get(self.prefix+'/tender/pages/99/image').status_code,404)
        self.assertEqual(self.client.get(self.prefix+'/tender/pages/1/image').headers['content-type'],'image/png')

    def test_without_tender_still_answers(self):
        self.client.delete(self.prefix+'/tender')
        result=self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'}).json()
        self.assertFalse(result['cached']);self.assertNotIn('tender',self.mock_ask.call_args.kwargs)

    def test_real_answer_assembly_uses_tender_and_validates_refs(self):
        selected=tender.select_tender(index_fixture(),spec_fixture(),'FF-06','FF-06')
        response={'choices':[{'message':{'content':json.dumps(dict(answer='850 m2 [Tender r1]',sources=[],
                         tender_refs=[dict(row_id='r1',quote='850'),dict(row_id='r999',quote='wrong')]))},'finish_reason':'stop'}], 'usage':{}}
        with patch.object(chat,'render_inputs',return_value=[]),patch.object(chat.httpx,'post') as request:
            request.return_value.json.return_value=response
            result=chat.ask_sheet('unused',1,'FF-06',chat.Question(question='FF-06'),'offline','test',tender=selected)
        payload=request.call_args.kwargs['json']
        sent=json.loads(payload['messages'][-1]['content'][0]['text'])
        self.assertIn('tender_summary',sent)
        self.assertEqual(len(result['tender_refs']),1)
        self.assertTrue(result['tender_refs'][0]['verified'])


class SheetScopeTests(unittest.TestCase):
    """The tender attachment is normally the tender DRAWING set, so a row's page is a sheet."""

    NAMES=['alpha','bravo','charlie','delta','echo','foxtrot']

    def index(self):
        rows=[dict(row_fixture(),id=f'r{n}',page=(n+1)//2,
                   text=f'{self.NAMES[n-1]} finish item\n{100+n}\nm2') for n in range(1,7)]
        return dict(index_fixture(),rows=rows)

    def test_only_this_sheets_rows_are_supplied(self):
        chosen=tender.select_tender(self.index(),spec_fixture(),'FF-06','tile',page=2)
        self.assertEqual([r['id'] for r in chosen['rows']],['r3','r4'])
        self.assertEqual(chosen['page'],2)

    def test_a_sheets_rows_are_sent_even_without_matching_words(self):
        chosen=tender.select_tender(self.index(),spec_fixture(),'','completely unrelated wording',page=3)
        self.assertEqual([r['id'] for r in chosen['rows']],['r5','r6'])

    def test_rows_arrive_in_printed_order_not_by_score(self):
        # r6 scores higher, but a schedule must read the way it is drawn.
        chosen=tender.select_tender(self.index(),spec_fixture(),'','foxtrot',page=3)
        self.assertEqual([r['id'] for r in chosen['rows']],['r5','r6'])

    def test_a_separate_tender_document_still_searches_every_page(self):
        # Asked from sheet 1, a matching row on sheet 3 is still reachable.
        chosen=tender.select_tender(self.index(),spec_fixture(),'','foxtrot')
        self.assertEqual([r['id'] for r in chosen['rows']],['r6'])
        self.assertIsNone(chosen['page'])

    def test_an_empty_sheet_supplies_nothing(self):
        chosen=tender.select_tender(self.index(),spec_fixture(),'FF-06','tile',page=99)
        self.assertEqual(chosen['rows'],[])
        self.assertFalse(chosen['truncated'])


class SheetScopeApiTests(ApiTests):
    """Wiring: the page reaches select_tender only when tender.pdf is the drawing set."""

    def test_same_pdf_limits_rows_to_the_open_sheet(self):
        self.folder.joinpath('tender.pdf').write_bytes(self.folder.joinpath('source.pdf').read_bytes())
        index=tender.index_tender(self.folder/'tender.pdf','Tender Drawings.pdf')
        main.atomic(self.folder/'tender.json',index)
        with patch.object(main.tender_tools,'select_tender',wraps=tender.select_tender) as select:
            self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'})
        self.assertEqual(select.call_args.kwargs['page'],1)

    def test_a_different_pdf_searches_the_whole_tender(self):
        with patch.object(main.tender_tools,'select_tender',wraps=tender.select_tender) as select:
            self.client.post(self.prefix+'/pages/1/chat',json={'question':'What is FF-06?'})
        self.assertIsNone(select.call_args.kwargs['page'])


if __name__=='__main__':
    unittest.main()
