"""Run the optional offline browser regression against temporary data only."""
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from backend import main, bom, suppliers
import bom_fixture as fixture


def provider(*args, **kwargs):
    time.sleep(2)
    return fixture.provider(*args, **kwargs)


def discovery(item, filters, key, model):
    time.sleep(2)
    return dict(model=model, usage=dict(total_tokens=100, cost=0), results=[dict(
        company='Test supplier', product='600 x 600 mm porcelain tile', city='Kuala Lumpur',
        state='Kuala Lumpur', country='Malaysia', location='Kuala Lumpur Malaysia',
        email='sales@supplier.example', phone='+60 3 1234 5678',
        source_url='https://supplier.example/tile', contact_source_url='https://supplier.example/contact',
        unit_price=10, currency='MYR', unit='m2', price_comparable=True,
        price_evidence='MYR 10 per m2', match_level='strong', match_reason='Synthetic cited fixture.',
        specification_gaps='')])


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='atlas-procurement-preview-') as tmp:
        root = Path(tmp)
        directory = root / 'abcdef012345'
        directory.mkdir()
        for name in ['source', 'tender']:
            (directory / (name + '.pdf')).write_bytes(fixture.pdf())
        main.atomic(directory / 'index.json', dict(id=directory.name, name='Offline Procurement fixture',
            filename='Drawings.pdf', page_count=1, pages=[dict(page=1, text=fixture.TEXT, areas=[],
            needs_review=False, reviewed=True, discipline='Architecture', width=595, height=842)],
            areas=[], stages=[], hotspots=[], warnings=[], overview_page=None, generation_complete=True))
        main.atomic(directory / 'tender.json', dict(filename='Tender.pdf', page_count=1,
            hash='fixture', version=1, uploaded=bom.now(), rows=[], warnings=[]))
        with patch.object(main, 'DATA', root), patch.object(main, 'ready', return_value=True), \
             patch.object(main, 'current_model', return_value='test-model'), \
             patch.dict(os.environ, {'OPENROUTER_API_KEY': 'offline-key'}), \
             patch.object(bom, 'request_ai', side_effect=provider), \
             patch.object(suppliers, 'discover', side_effect=discovery):
            uvicorn.run(main.app, host='127.0.0.1', port=8001, lifespan='off')
