"""Synthetic AI BOM fixtures; never call a provider."""
import copy
import json
import hashlib
import pymupdf as fitz
from backend import bom
from backend.ingestion import atomic

TEXT = 'FF-06 Porcelain floor tile 600 x 600 mm\nQuantity 100 m2\nBudget MYR 2000\nProject location Kuala Lumpur Malaysia'


def pdf(text=TEXT):
    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((30, 60), text, fontsize=11)
        return doc.tobytes()


def bill():
    return dict(materials=[dict(name='Porcelain floor tile', codes=['FF-06'], specification='600 x 600 mm porcelain floor tile',
        brand='', quantity=100, unit='m2', budget=2000, currency='MYR', location='Kuala Lumpur', category='required',
        quantity_basis='Explicit total from the tender; source drawing reference is not added.', conflicts=[], resolution='',
        confidence_fields=dict(identity='high', specification='high', quantity='high', cost='high'),
        sources=[dict(kind='tender', page=1, quote=TEXT, fields=['name','specification','quantity','unit','budget','currency','location'])],
        search_plan=dict(location='Kuala Lumpur', country='Malaysia', state='', company='', currency='MYR', max_unit_price=None,
                         basis='Location and currency are printed in the tender; no price ceiling is inferred.'))], warnings=[], coverage='All supplied pages checked.')


def seed(directory, changes=None):
    value = bill()
    if changes:
        value['materials'][0].update(changes)
    documents = {}
    for entry in bom.manifest(directory):
        path=directory/(entry['kind']+'.pdf')
        with fitz.open(path) as doc:
            pages=[dict(page=i+1,text=p.get_text()) for i,p in enumerate(doc)]
        documents[entry['kind']]=dict(filename=entry['filename'],hash=hashlib.sha256(path.read_bytes()).hexdigest(),pages=pages)
    snapshot = bom.validate_bill(value, documents)
    snapshot.update(version=bom.uuid_version(), fingerprint='fixture', prompt_version=bom.VERSION, model='test-model', created_at=bom.now(),
        manifest=bom.manifest(directory), documents={k:dict(filename=d['filename'],hash=d['hash'],pages=len(d['pages'])) for k,d in documents.items()},
        usage=dict(requests=2,tokens=200,reported_cost_usd=.01))
    atomic(directory/'bom.json',snapshot)
    return snapshot


def provider(*args, **kwargs):
    return json.dumps(bill()), dict(total_tokens=100,cost=.005)
