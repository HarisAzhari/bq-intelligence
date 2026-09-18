"""Supplier discovery contracts: mocked provider only, no paid web requests."""
import copy
import json
import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend import main, procurement, suppliers
import test_procurement as fixture


def provider_payload():
    lead = dict(company='Example Tiles', product='Porcelain tile 600 x 600 mm', location='Kuala Lumpur',
        source_url='https://supplier.example/products/tile', unit_price=12.5, currency='MYR', unit='m2',
        price_evidence='MYR 12.50 per m2', location_evidence='Example Tiles is based in Kuala Lumpur.',
        match_reason='Product dimensions match.', specification_gaps='Confirm grade, finish and stock.')
    citation = dict(url=lead['source_url'], title='Example Tiles — porcelain tiles',
                    content='Example Tiles is based in Kuala Lumpur. Porcelain tile 600 x 600 mm. MYR 12.50 per m2.')
    return dict(choices=[dict(message=dict(content=json.dumps(dict(suppliers=[lead])),
        annotations=[dict(type='url_citation', url_citation=citation)]))], usage=dict(total_tokens=500, cost=.02))


class SupplierTests(unittest.TestCase):
    def setUp(self):
        self.filters = suppliers.SupplierSearch(revision=0, item_id='a', location='Kuala Lumpur', currency='MYR', max_unit_price=20)
        self.material = dict(unit='m2', name='Porcelain tiles', specification='600 x 600 mm', quantity=100)

    def parse(self, payload=None):
        return suppliers.parse_results(payload or provider_payload(), self.filters, self.material)

    def edit_lead(self, **changes):
        payload = provider_payload()
        data = json.loads(payload['choices'][0]['message']['content'])
        data['suppliers'][0].update(changes)
        payload['choices'][0]['message']['content'] = json.dumps(data)
        return payload

    def test_cited_comparable_result_is_accepted(self):
        result = self.parse()
        self.assertTrue(result['results'][0]['price_comparable'])
        self.assertEqual(result['results'][0]['unit_price'], 12.5)
        self.assertEqual(result['usage']['cost'], .02)

    def test_no_citations_is_an_error_not_invented_suppliers(self):
        payload = provider_payload(); payload['choices'][0]['message']['annotations'] = []
        with self.assertRaises(HTTPException) as error:
            self.parse(payload)
        self.assertEqual(error.exception.status_code, 502)

    def test_unknown_url_or_company_is_omitted(self):
        for changes in [dict(source_url='https://invented.example/item'), dict(company='Imaginary Seller')]:
            self.assertEqual(self.parse(self.edit_lead(**changes))['results'], [])

    def test_location_and_company_filter(self):
        self.filters.location = 'Penang'
        self.assertEqual(self.parse()['results'], [])
        self.filters.location = 'Kuala Lumpur'; self.filters.company = 'Other'
        self.assertEqual(self.parse()['results'], [])

    def test_budget_and_unknown_price_filters(self):
        self.filters.max_unit_price = 10
        self.assertEqual(self.parse()['results'], [])
        result = self.parse(self.edit_lead(price_evidence='Invented published price MYR 8 per m2', unit_price=8))
        self.assertIsNone(result['results'][0]['unit_price'])
        self.filters.include_unknown_prices = False
        self.assertEqual(self.parse(self.edit_lead(price_evidence='Made up', unit_price=8))['results'], [])

    def test_unit_and_currency_are_not_converted(self):
        for changes in [dict(unit='box'), dict(currency='USD')]:
            lead = self.parse(self.edit_lead(**changes))['results'][0]
            self.assertFalse(lead['price_comparable'])
            self.assertIsNone(lead['unit_price'])

    def test_private_and_script_links_are_rejected(self):
        for value in ('javascript:alert(1)', 'file:///C:/Windows', 'http://localhost/a', 'http://127.0.0.1',
                      'https://user:pass@example.com', 'http://192.168.0.1/a'):
            self.assertFalse(suppliers.public_url(value))
        self.assertTrue(suppliers.public_url('https://supplier.example/products'))

    def test_discovery_request_caps_search_and_does_not_send_documents(self):
        response = unittest.mock.Mock()
        response.json.return_value = provider_payload()
        with patch.object(suppliers.httpx, 'post', return_value=response) as request:
            result = suppliers.discover(self.material, self.filters, 'offline-key', 'test-model')
        sent = request.call_args.kwargs['json']
        self.assertEqual(sent['tools'][0]['type'], 'openrouter:web_search')
        self.assertEqual(sent['max_tool_calls'], 2)
        self.assertEqual(sent['tools'][0]['parameters']['max_total_results'], 8)
        self.assertNotIn('pdf', json.dumps(sent))
        self.assertEqual(len(result['results']), 1)

    def test_malformed_response_fails_cleanly(self):
        with self.assertRaises(HTTPException):
            self.parse(dict(choices=[dict(message=dict(content='not json'))]))


class ContactTests(unittest.TestCase):
    def test_contacts_and_location_require_their_own_citation(self):
        payload=provider_payload()
        data=json.loads(payload['choices'][0]['message']['content'])
        lead=data['suppliers'][0]
        lead.update(city='Kuala Lumpur',state='Selangor',country='Malaysia',email='sales@example.com',phone='+60 3 1234 5678',
            contact_source_url='https://supplier.example/contact',
            contact_evidence='Example Tiles email sales@example.com telephone +60 3 1234 5678',
            location_evidence='Example Tiles is based in Kuala Lumpur.')
        payload['choices'][0]['message']['content']=json.dumps(data)
        filters=suppliers.SupplierSearch(revision=0,item_id='a',location='',currency='MYR')
        result=suppliers.parse_results(payload,filters,dict(unit='m2'))['results'][0]
        self.assertEqual(result['email'],'');self.assertEqual(result['phone'],'')
        self.assertEqual(result['city'],'Kuala Lumpur');self.assertEqual(result['state'],'');self.assertEqual(result['country'],'')
        payload['choices'][0]['message']['annotations'].append(dict(type='url_citation',url_citation=dict(
            url=lead['contact_source_url'],title='Example Tiles contact',content=lead['contact_evidence'])))
        result=suppliers.parse_results(payload,filters,dict(unit='m2'))['results'][0]
        self.assertEqual(result['email'],'sales@example.com');self.assertEqual(result['phone'],'+60 3 1234 5678')

    def test_unknown_project_location_does_not_invent_a_filter(self):
        filters=suppliers.SupplierSearch(revision=0,item_id='a',location='',currency='')
        result=suppliers.parse_results(provider_payload(),filters,dict(unit='m2'))
        self.assertEqual(len(result['results']),1)
        self.assertFalse(result['results'][0]['price_comparable'])

if __name__=='__main__':
    unittest.main()
