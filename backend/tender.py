"""Local tender extraction, conservative material links and grounded row retrieval."""
import hashlib
import json
import re
import time
from pathlib import Path

import pymupdf as fitz

from backend.indexer import PDF_LOCK
from backend.specs import find_codes, terms

VERSION = 1
MATCH_VERSION = 1
ROW_LIMIT = 16          # rows sent when the tender is a separate document
SHEET_ROW_LIMIT = 120   # rows sent when they are this drawing sheet's own rows
TEXT_BUDGET = 22000
FIELDS = {
    'item': ('item', 'item no', 'item number', 'no', 'bill item', 'ref'),
    'code': ('code', 'material code', 'spec code', 'reference'),
    'description': ('description', 'description of works', 'particulars', 'work description', 'material'),
    'unit': ('unit', 'units', 'uom'),
    'quantity': ('qty', 'quantity', 'quantities'),
    'rate': ('rate', 'unit rate', 'unit price'),
    'amount': ('amount', 'total amount', 'total', 'price'),
    'location': ('location', 'area', 'zone', 'room'),
}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def header_field(value):
    value = re.sub(r'[^a-z0-9 ]', ' ', str(value or '').lower())
    value = ' '.join(value.split())
    for field, names in FIELDS.items():
        if value in names:
            return field
    for name, field in sorted(((name, field) for field, names in FIELDS.items() for name in names), key=lambda pair: -len(pair[0])):
        if len(name) > 3 and value.startswith(name + ' '):
            return field
    return None


def normalized_box(page, rect):
    rect = fitz.Rect(rect) * page.rotation_matrix
    bounds = page.rect
    return [max(0, min(1, v)) for v in (rect.x0 / bounds.width, rect.y0 / bounds.height,
                                       rect.x1 / bounds.width, rect.y1 / bounds.height)]


def index_tender(path, filename):
    data = Path(path).read_bytes()
    rows, warnings, pages = [], [], []
    with PDF_LOCK, fitz.open(stream=data, filetype='pdf') as doc:
        if not doc.is_pdf or doc.needs_pass:
            raise ValueError('Choose a valid, unlocked PDF.')
        if not 1 <= len(doc) <= 1000:
            raise ValueError('The tender summary must contain 1–1000 pages.')
        for number, page in enumerate(doc, 1):
            text = page.get_text('text')
            pages.append(dict(page=number, text=text[:40000]))
            count = len(rows)
            tables = []
            try:
                tables = list(page.find_tables().tables)
            except Exception:
                pass
            for table in tables:
                cells = table.extract()
                columns, start = {}, 0
                # External headers are separate from the data; ordinary headers occur in rows.
                if table.header.external:
                    columns = {i: header_field(v) for i, v in enumerate(table.header.names) if header_field(v)}
                if 'description' not in columns.values():
                    for i, values in enumerate(cells[:5]):
                        proposed = {j: header_field(v) for j, v in enumerate(values) if header_field(v)}
                        if 'description' in proposed.values() and len(proposed) >= 2:
                            columns, start = proposed, i + 1
                            break
                if 'description' not in columns.values():
                    continue
                for i in range(start, len(cells)):
                    values = cells[i]
                    fields = {field: str(values[j] or '').strip() for j, field in columns.items() if j < len(values)}
                    description = fields.get('description', '')
                    if not description or header_field(description) == 'description':
                        continue
                    # Subtotals are searchable source rows, never auto-linked as materials.
                    subtotal = bool(re.match(r'^(?:sub\s*total|total|carried|brought|summary)\b', description, re.I))
                    raw = '\n'.join(str(v).strip() for v in values if v)
                    rows.append(dict(id=f'r{len(rows)+1}', page=number, text=raw,
                                     box=normalized_box(page, table.rows[i].bbox), fields=fields,
                                     codes=sorted(find_codes(fields.get('code', '') + ' ' + description)),
                                     structured=True, extraction_review=subtotal))
            if len(rows) == count:
                # Never guess commercial columns from prose or an unrecognized table layout.
                for block in page.get_text('blocks'):
                    raw = str(block[4]).strip()
                    if len(raw) < 12 or not re.search('[A-Za-z]{3}', raw):
                        continue
                    rows.append(dict(id=f'r{len(rows)+1}', page=number, text=raw[:12000],
                                     box=normalized_box(page, block[:4]), fields={'description': raw[:12000]},
                                     codes=sorted(find_codes(raw)), structured=False, extraction_review=True))
                warnings.append(f'Page {number}: no recognized table. Text blocks need source review; commercial columns were not inferred.'
                                if text.strip() else f'Page {number}: no readable text. Scanned pages need a searchable PDF; OCR is not included.')
    return dict(version=VERSION, hash=hashlib.sha256(data).hexdigest(), filename=Path(filename).name[:200],
                page_count=len(pages), uploaded=int(time.time()*1000), rows=rows, pages=pages, warnings=warnings,
                decisions={})


def spec_identity(spec):
    return dict(hash=spec.get('hash'), version=spec.get('version')) if spec else None


def context_hash(index, spec):
    if not index:
        return None
    return digest(dict(tender=index['hash'], extraction=index['version'], matcher=MATCH_VERSION,
                       spec=spec_identity(spec), decisions=index.get('decisions', {})))


def summary(index, spec):
    if not index:
        return None
    return dict(filename=index['filename'], hash=index['hash'], page_count=index['page_count'],
                uploaded=index['uploaded'], row_count=len(index['rows']), warnings=index['warnings'],
                context_hash=context_hash(index, spec))


def dimensions(text):
    return set(re.sub(r'\s+', '', m.lower()).replace('×', 'x') for m in
               re.findall(r'\b\d+(?:\.\d+)?\s*(?:[x×]\s*\d+(?:\.\d+)?\s*){0,2}(?:mm|cm)\b', text, re.I))


def material_terms(text):
    generic = {'suppl', 'install', 'work', 'includ', 'complete', 'item', 'material', 'product', 'type', 'specification'}
    return set(terms(re.sub(r'\b[A-Z]{2,3}\s*-?\s*\d{2}\b', '', text))) - generic


def compatibility(row, item):
    description = row['fields'].get('description', '')
    a, b = material_terms(description), material_terms(item.get('title', ''))
    overlap = len(a & b) / max(1, len(b))
    conflicts = []
    left, right = dimensions(description), dimensions(item.get('title', ''))
    if left and right and not left & right:
        conflicts.append('Printed dimensions differ from the specification title.')
    colours = {'white', 'black', 'grey', 'gray', 'red', 'blue', 'green', 'beige', 'brown'}
    ca, cb = a & colours, b & colours
    if ca and cb and not ca & cb:
        conflicts.append('Printed colours differ.')
    for alternatives in ({'floor', 'wall'}, {'polished', 'unpolished'}, {'gloss', 'matt', 'matte'}):
        da = set(re.findall(r'[a-z]+', description.lower())) & alternatives
        db = set(re.findall(r'[a-z]+', item.get('title', '').lower())) & alternatives
        if da and db and not da & db:
            conflicts.append('Printed application or finish differs.')
    if a and b and not a & b:
        conflicts.append('The material descriptions have no meaningful words in common.')
    return overlap, conflicts


def match_row(row, spec, decisions):
    items = {i['code']: i for i in (spec or {}).get('items', [])}
    decision = decisions.get(row['id'])
    if decision and decision.get('spec') == spec_identity(spec):
        codes = decision.get('codes', [])
        if decision['action'] == 'unmatched':
            return dict(status='unmatched', codes=[], candidates=[], reasons=['Left unmatched by reviewer.'], reviewed=True)
        if codes and all(code in items for code in codes):
            return dict(status='confirmed', codes=codes, candidates=[], reasons=['Confirmed by reviewer.'], reviewed=True)
    exact = [code for code in row['codes'] if code in items]
    candidates = []
    for code, item in items.items():
        score, conflicts = compatibility(row, item)
        if code in exact or score > 0:
            candidates.append(dict(code=code, title=item.get('title', ''), pages=item.get('pages', []),
                                   score=round(score, 3), reasons=(['Exact printed code.'] if code in exact else ['Description word overlap; review required.']) + conflicts))
    candidates.sort(key=lambda c: (c['code'] not in exact, -c['score'], c['code']))
    if len(row['codes']) > 1 and exact:
        status, codes, reasons = 'ambiguous', [], ['Several material codes occur in this row. Review as a group; do not split its quantity automatically.']
    elif len(exact) == 1:
        score, conflicts = compatibility(row, items[exact[0]])
        if conflicts:
            status, reasons = 'conflict', conflicts
        elif row['extraction_review'] or score < .5:
            status, reasons = 'suggested', ['Code matches; verify the extracted row and material description.']
        else:
            status, reasons = 'confirmed', ['Exact code and compatible description. This is an identity link, not a full specification compliance check.']
        codes = exact if status == 'confirmed' else []
    elif len(exact) > 1:
        status, codes, reasons = 'ambiguous', [], ['Several material codes occur in this row. Review as a group; do not split its quantity automatically.']
    elif candidates:
        status, codes, reasons = ('ambiguous' if len(candidates) > 1 and candidates[0]['score'] - candidates[1]['score'] < .15 else 'suggested'), [], ['No exact code. Description matches are suggestions only.']
    else:
        status, codes, reasons = 'unmatched', [], ['No matching specification item.' if items else 'Add a technical specification with coded items to propose links.']
    if decision and decision.get('spec') != spec_identity(spec):
        status, codes = 'suggested', []
        reasons.insert(0, 'The specification changed; review the previous decision again.')
    return dict(status=status, codes=codes, candidates=candidates[:8], reasons=reasons, reviewed=False)


def review_rows(index, spec, drawings=None):
    code_pages = {}
    for page in (drawings or {}).get('pages', []):
        for code in find_codes(page.get('text', '')):
            code_pages.setdefault(code, []).append(page['page'])
    result = []
    for row in index['rows']:
        link = match_row(row, spec, index.get('decisions', {}))
        drawing_pages = sorted({p for c in link['codes'] for p in code_pages.get(c, [])})
        result.append(dict(row, link=link, drawing_pages=drawing_pages))
    return result


def select_tender(index, spec, sheet_text, question, history=(), page=None):
    """Tender rows for one question.

    When the tender attachment is the tender drawing set itself, `page` is the sheet being asked
    about: its own printed rows are the evidence, and rows printed on other sheets are out of
    scope, exactly as other drawing sheets are. `page=None` searches the whole document, which is
    what a separately issued tender summary needs.
    """
    sheet_codes, question_codes = find_codes(sheet_text), find_codes(question)
    query = set(terms(question))
    earlier = set(terms(' '.join(t['content'] for t in history if t.get('role') == 'user')[-4000:]))
    decisions = index.get('decisions', {})
    scored = []
    for order, row in enumerate(index['rows']):
        if page is not None and row['page'] != page:
            continue
        row = dict(row, link=match_row(row, spec, decisions))
        linked = set(row['link']['codes'])
        row_terms = set(terms(row['text']))
        score = len(query & row_terms) * 2
        score += min(2, len(earlier & row_terms)) if score else 0
        if question_codes & (linked | set(row['codes'])):
            score += 40
        if linked & sheet_codes:
            score += 8
        if re.search(r'\b' + re.escape(row['id']) + r'\b', question, re.I):
            score += 60
        # Every row printed on the sheet is evidence, whether or not it echoes the question.
        if score or page is not None:
            scored.append((-score, order, row))
    scored.sort()
    limit = SHEET_ROW_LIMIT if page is not None else ROW_LIMIT
    picked, size = [], 0
    for _, order, row in scored:
        if len(picked) >= limit or size + len(row['text']) > TEXT_BUDGET:
            break
        size += len(row['text'])
        picked.append((order, row))
    # Supplied in printed order, so a schedule reads the way it is drawn.
    chosen = [row for _, row in sorted(picked, key=lambda value: value[0])]
    return dict(filename=index['filename'], hash=index['hash'], context_hash=context_hash(index, spec),
                rows=chosen, row_count=len(index['rows']), page=page, sheet_row_count=len(scored),
                warnings=index['warnings'], truncated=len(chosen) < len(scored))


def locate_tender_refs(selected, refs):
    """Only cite rows actually supplied to the model, using original extracted values."""
    allowed = {r['id']: r for r in selected['rows']}
    result, seen = [], set()
    for ref in refs[:16]:
        if not isinstance(ref, dict) or ref.get('row_id') not in allowed or ref['row_id'] in seen:
            continue
        row = allowed[ref['row_id']]
        quote = str(ref.get('quote') or '')[:400].strip()
        verified = bool(quote) and ' '.join(quote.split()) in ' '.join(row['text'].split())
        result.append(dict(row_id=row['id'], page=row['page'], title=row['fields'].get('description', '')[:160],
                           quote=quote, verified=verified, box=row['box'], fields=row['fields'],
                           status=row['link']['status'], codes=row['link']['codes']))
        seen.add(row['id'])
    return result
