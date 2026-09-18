"""Offline AI BOM, job lifecycle and purchasing regressions."""
import json
import os
import tempfile
import threading
import time
import unittest
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend import main, procurement, bom
from backend.procurement_jobs import Jobs
import bom_fixture as fixture

pdf = fixture.pdf

class ProcurementTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.pid='abcdef012345';self.directory=self.root/self.pid;self.directory.mkdir()
        for helper in [patch.object(main,'DATA',self.root),patch.object(main,'ready',return_value=True),
                       patch.object(main,'current_model',return_value='test-model'),patch.dict(os.environ,{'OPENROUTER_API_KEY':'offline-key'})]:
            helper.start();self.addCleanup(helper.stop)
        main.SPEC_CACHE.clear()
        self.directory.joinpath('source.pdf').write_bytes(fixture.pdf())
        self.directory.joinpath('tender.pdf').write_bytes(fixture.pdf())
        main.atomic(self.directory/'index.json',dict(id=self.pid,name='Procurement test project',filename='Drawings.pdf',page_count=1,pages=[dict(page=1,text=fixture.TEXT)]))
        main.atomic(self.directory/'tender.json',dict(filename='Tender.pdf',page_count=1))
        self.client=TestClient(main.app);self.addCleanup(self.client.close)
        self.url=f'/api/projects/{self.pid}/procurement';self.view=self.get()

    def get(self):
        response=self.client.get(self.url);self.assertEqual(response.status_code,200,response.text);return response.json()

    def send(self,path,data,method='post',expected=200):
        response=getattr(self.client,method)(self.url+path,json=dict(revision=self.view['revision'],**data))
        self.assertEqual(response.status_code,expected,response.text)
        if expected==200:self.view=response.json()
        return response

    def review(self,**changes):
        # Seed a validated AI snapshot, rather than exercising a removed review form.
        fixture.seed(self.directory,changes);self.view=self.get();return self.view['items'][0]

    def quote(self,**overrides):
        body=dict(item_id=self.view['items'][0]['id'],supplier='Supplier A',reference='Q-100',product='Tile A',
          specification='600 x 600 mm porcelain floor tile',unit='m2',currency='MYR',unit_price=10,shipping=20,tax_percent=6,
          minimum_quantity=1,available_quantity=1000,lead_days=2,valid_until=(date.today()+timedelta(days=30)).isoformat(),
          compliance_notes='Meets dimensions and grade.',verified_by='Buyer')
        body.update(overrides);self.send('/quotes',body);return self.view['quotes'][-1]

    def cart(self,quantity=100):
        self.send('/cart',dict(quote_id=self.view['quotes'][-1]['id'],quantity=quantity))

    def checkout(self,expected=200,**changes):
        body=dict(buyer='Project',delivery_address='Site 1',requested_by='Buyer',required_date=(date.today()+timedelta(days=10)).isoformat())
        body.update(changes);return self.send('/orders',body,expected=expected)

    def wait_job(self,kind='bom'):
        deadline=time.monotonic()+6
        while time.monotonic()<deadline:
            job=self.client.get(self.url+'/jobs').json()[kind]
            if job['status'] not in ('queued','running','cancelling'):return job
            time.sleep(.015)
        self.fail('Job did not finish within the offline test deadline')

    def start(self,kind='bom',force=False):
        suffix='/bom/generate' if kind=='bom' else '/suppliers/batch'
        response=self.client.post(self.url+suffix+'?force='+str(force).lower())
        self.assertEqual(response.status_code,202,response.text)

    def test_open_is_read_only_and_never_extracts_or_calls_ai(self):
        with patch.object(bom,'prepare',side_effect=AssertionError('Do not prepare on GET')),patch.object(bom,'request_ai') as provider:
            self.assertEqual(self.get()['items'],[])
            self.assertEqual(self.get()['jobs']['bom']['status'],'idle')
        provider.assert_not_called()
        self.assertFalse((self.directory/'procurement-extraction.json').exists())

    def test_two_pass_generation_cache_and_force(self):
        with patch.object(bom,'request_ai',side_effect=fixture.provider) as provider:
            self.start();self.assertEqual(self.wait_job()['status'],'complete')
            self.assertEqual(provider.call_count,2)
            first=self.get()['bom']['version']
            self.start();self.assertEqual(self.wait_job()['status'],'complete')
            self.assertEqual(provider.call_count,2)
            self.assertEqual(self.get()['bom']['version'],first)
            self.start(force=True);self.assertEqual(self.wait_job()['status'],'complete')
            self.assertEqual(provider.call_count,4)
            self.assertNotEqual(self.get()['bom']['version'],first)
        self.assertEqual(len(self.get()['bom_history']),2)
        self.assertTrue(self.get()['items'][0]['procurement_ready'])

    def test_job_does_not_hold_app_lock_and_cancel_preserves_bom(self):
        self.review();original=self.view['bom']['version']
        entered=threading.Event();release=threading.Event();self.addCleanup(release.set)
        def slow(*args,**kwargs):
            entered.set();release.wait(3);return fixture.provider()
        with patch.object(bom,'request_ai',side_effect=slow):
            self.start(force=True);self.assertTrue(entered.wait(2))
            acquired=main.LOCK.acquire(timeout=.2);self.assertTrue(acquired)
            if acquired:main.LOCK.release()
            self.assertEqual(self.client.get(self.url+'/jobs').status_code,200)
            duplicate=self.client.post(self.url+'/bom/generate');self.assertEqual(duplicate.status_code,409)
            self.client.post(self.url+'/jobs/bom/cancel');release.set()
            self.assertEqual(self.wait_job()['status'],'cancelled')
        self.assertEqual(self.get()['bom']['version'],original)

    def test_failed_validation_keeps_saved_bom_and_resumes_draft(self):
        self.review();original=self.view['bom']['version']
        with patch.object(bom,'request_ai',side_effect=[fixture.provider(),ValueError('Audit failed')]) as provider:
            self.start();self.assertEqual(self.wait_job()['status'],'failed')
            self.assertEqual(provider.call_count,2)
        self.assertEqual(self.get()['bom']['version'],original)
        with patch.object(bom,'request_ai',side_effect=fixture.provider) as provider:
            self.start();self.assertEqual(self.wait_job()['status'],'complete');self.assertEqual(provider.call_count,1)

    def test_document_change_marks_stale_without_paid_regeneration(self):
        self.review();self.directory.joinpath('tender.pdf').write_bytes(fixture.pdf(fixture.TEXT+'\nNew revision'))
        with patch.object(bom,'request_ai') as provider:
            view=self.get()
        self.assertTrue(view['bom_stale']);self.assertFalse(view['items'][0]['procurement_ready']);provider.assert_not_called()
        self.assertEqual(self.client.post(self.url+'/suppliers/batch').status_code,409)

    def test_restore_uses_saved_version_without_ai(self):
        with patch.object(bom,'request_ai',side_effect=fixture.provider):
            self.start();self.wait_job();version=self.get()['bom']['version']
            self.start(force=True);self.wait_job()
        with patch.object(bom,'request_ai') as provider:
            response=self.client.post(self.url+'/bom/restore/'+version)
        self.assertEqual(response.status_code,200);self.assertEqual(response.json()['bom']['version'],version);provider.assert_not_called()

    def test_material_mutations_removed(self):
        self.review();self.send('/materials',dict(name='Manual'),expected=409)
        self.send('/materials/'+self.view['items'][0]['id'],{},method='patch',expected=409)

    def test_end_to_end_order_and_partial_receipts(self):
        self.review();self.quote();self.cart();self.checkout()
        order=self.view['orders'][0];self.assertEqual(order['total'],1081.2);path='/orders/'+order['id']
        for action in ('approve','issue'):
            self.send(path+'/action',dict(action=action,actor='Buyer'))
        self.assertEqual(self.client.get(self.url+path+'/document').status_code,200)
        self.send(path+'/action',dict(action='ordered',actor='Buyer',reference='ACK-1'))
        line=order['lines'][0]['id']
        self.send(path+'/action',dict(action='receive',actor='Store',reference='DN-1',receipts={line:60}))
        self.assertEqual(self.view['orders'][0]['status'],'partially_delivered')
        self.send(path+'/action',dict(action='receive',actor='Store',reference='DN-2',receipts={line:41}),expected=400)
        self.send(path+'/action',dict(action='receive',actor='Store',reference='DN-2',receipts={line:40}))
        self.assertEqual(self.get()['orders'][0]['status'],'delivered')

    def test_stale_quote_cannot_enter_cart(self):
        self.review();q=self.quote();self.review(specification='Different size')
        self.send('/cart',dict(quote_id=q['id'],quantity=100),expected=404)

    def test_changed_evidence_invalidates_quote_with_same_material_id(self):
        self.review();q=self.quote();self.review(resolution='New scope clarification')
        self.send('/cart',dict(quote_id=q['id'],quantity=100),expected=409)

    def test_low_confidence_cannot_be_purchased_or_sourced(self):
        item=self.review(confidence_fields=dict(identity='low',specification='low',quantity='high',cost='high'))
        self.assertFalse(item['procurement_ready'])
        self.assertFalse(item['search_ready'])
        self.assertEqual(item['status'],'Needs attention')

    def test_budget_currency_and_excess_quantity_require_explanation(self):
        self.review();self.quote(currency='USD');self.cart();self.checkout(expected=400)
        self.checkout(exception_reason='Separate currency allowance confirmed.')
        self.cart();self.checkout(expected=400)

    def test_missing_evidence_blocks_purchasing_but_does_not_invent_quantity(self):
        self.review(quantity=999)
        item=self.view['items'][0];self.assertIsNone(item['quantity']);self.assertFalse(item['procurement_ready'])
        self.assertEqual(self.client.get(self.url+'/rfq').status_code,400)

    def test_restart_is_reported_not_silently_retried(self):
        main.atomic(self.directory/'bom-job.json',dict(status='running',phase='analysing'))
        with patch.object(bom,'request_ai') as provider:
            status=self.client.get(self.url+'/jobs').json()['bom']
        self.assertEqual(status['status'],'interrupted');provider.assert_not_called()

    def test_source_citation_rejects_changed_documents(self):
        self.review();ref=self.view['items'][0]['sources'][0]
        self.assertEqual(self.client.get(self.url+f"/source/{ref['kind']}/{ref['hash']}").status_code,200)
        self.directory.joinpath('tender.pdf').write_bytes(fixture.pdf('Changed'))
        self.assertEqual(self.client.get(self.url+f"/source/{ref['kind']}/{ref['hash']}").status_code,409)

    def test_supplier_batch_checkpoints_and_reuses_successes(self):
        self.review()
        result=dict(results=[dict(company='Example')],usage=dict(total_tokens=40,cost=.01),omitted=0,note='Mocked')
        with patch('backend.procurement_jobs.suppliers.discover',return_value=result) as provider:
            self.start('suppliers');self.assertEqual(self.wait_job('suppliers')['status'],'complete')
            self.start('suppliers');self.assertEqual(self.wait_job('suppliers')['reused'],1)
            self.assertEqual(provider.call_count,1)
        self.assertEqual(len(self.get()['supplier_results']),1)

    def test_supplier_failure_is_saved_and_retried_explicitly(self):
        self.review()
        with patch('backend.procurement_jobs.suppliers.discover',side_effect=ValueError('fail')):
            self.start('suppliers');job=self.wait_job('suppliers')
        self.assertEqual(job['failed'],1)
        with patch('backend.procurement_jobs.suppliers.discover',return_value=dict(results=[],usage={},omitted=0,note='none')) as provider:
            self.start('suppliers');self.assertEqual(self.wait_job('suppliers')['unavailable'],1);self.assertEqual(provider.call_count,1)

if __name__=='__main__':
    unittest.main()
