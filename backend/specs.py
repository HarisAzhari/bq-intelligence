"""Technical specification ("how to work" document) linked to a drawing project.

Indexing extracts the PDF's own text on this computer; nothing here calls a
provider. For each sheet question, a small set of relevant specification pages
is chosen locally and sent with the drawing, joined through the legend codes
(for example FF-06) that the drawings and the specification share.
"""
import base64
import hashlib
import math
import re
import statistics
import time
from collections import Counter
from pathlib import Path
import pymupdf as fitz
from backend.indexer import PDF_LOCK

VERSION = 3
MAX_PAGES = 3000
MIN_TEXT = 150          # fewer readable characters than this: treat the page as a picture
PAGE_TEXT_CAP = 20000   # characters stored per page
EXCERPT_CAP = 6000      # characters sent per page
EXCERPT_BUDGET = 45000  # characters sent per question
MAX_EXCERPTS = 10
FOLLOW_PAGES = 2        # pages after an item page sent with it (product data, method)
CONTINUATION_LIMIT = 15
INDEX_BUDGET = 12000
MAX_IMAGE_PAGES = 2

# Two or three capitals and two digits, written as "FF-06", "FF 06" or on two lines.
CODE = re.compile(r'(?<![A-Za-z0-9])([A-Z]{2,3})[ \t]*[-–]?[ \t]*\n?[ \t]*(\d{2})(?![0-9])')
LETTERS = re.compile(r'[A-Z]{2,3}')
DIGITS = re.compile(r'\d{2}')
SINGLE = re.compile(r'([A-Z]{2,3})\s*[-–]?\s*(\d{2})')
FIELD = re.compile(r'^(?:\d+(?:\.\d+)*\s+)?([A-Za-z][A-Za-z0-9 /&().,-]{0,30}?)\s*:\s*(\S.{0,200})$')
CODE_LABEL = re.compile(r'^(?:item\s+)?(?:spec(?:ification)?\s+)?(?:code|ref(?:erence)?)(?:\s+no\.?)?$', re.I)
TITLE_LABELS = [re.compile(p, re.I) for p in (r'^product\s*type$', r'^(?:product|item|material|system)$', r'^description$')]
BRAND_LABELS = [re.compile(p, re.I) for p in (r'^brand$', r'^manufacturer$', r'^supplier$')]
STOP = set('''the and for with this that what how are does which where when from into about can could should would
use using used any all there their per you your our have has had was were will shall may must not but its also than then
them they these those here please tell show give need want do did done get got make made been being onto upon over under
same such each other some more most very just like drawing sheet page look looking see seeing mean means meaning
explain simple word words thing things know shown shows showing here there'''.split())
SUFFIXES = ('ations', 'ation', 'ings', 'ing', 'ers', 'er', 'es', 's', 'ed')
# Everyday words (English and Malay). Real prose always contains some; text from a font
# without a usable character map (for example "YMJ" for "the") contains almost none.
COMMON = set('''the and of to in for is with be are on as by or at that this from all shall any not per its has
have will which into than dan yang untuk ke di dengan pada ini itu atau adalah'''.split())
_STATS = {}


def code_of(letters, digits):
    return f'{letters}-{digits}'


def find_codes(text):
    return {code_of(a, b) for a, b in CODE.findall(text or '')}


def stem(word):
    for suffix in SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[:-len(suffix)]
    return word


def terms(text):
    return [stem(t) for t in re.findall(r'[a-z0-9]+', (text or '').lower())
            if len(t) > 2 and t not in STOP and not t.isdigit()]


def _clean(text):
    text = re.sub(r'[ \t\u00a0]+', ' ', text or '')
    return re.sub(r'\n\s*\n+', '\n', text).strip()


def _lines(page, textpage):
    """Text lines (font-encoding damage undone where possible) with their largest font size,
    in displayed (rotated) coordinates."""
    out = []
    for block in page.get_text('dict', textpage=textpage)['blocks']:
        if block.get('type') != 0:
            continue
        for line in block['lines']:
            text = _repair(''.join(span['text'] for span in line['spans']))
            if text:
                out.append((text, max(span['size'] for span in line['spans']),
                            fitz.Rect(line['bbox']) * page.rotation_matrix))
    return out


def _rows(words):
    """Words grouped into visual rows, so "Label : Value" table cells read as one line."""
    words = sorted(words, key=lambda w: ((w[0].y0 + w[0].y1) / 2, w[0].x0))
    rows, current, centre, height = [], [], 0, 0
    for rect, word in words:
        y = (rect.y0 + rect.y1) / 2
        if current and abs(y - centre) <= max(2, min(rect.height, height) * .45):
            current.append((rect, word))
            continue
        if current:
            rows.append(current)
        current, centre, height = [(rect, word)], y, rect.height
    if current:
        rows.append(current)
    return [' '.join(w for _, w in sorted(row, key=lambda item: item[0].x0)) for row in rows]


def _fields(words):
    fields = []
    for row in _rows(words):
        match = FIELD.match(row)
        if match and len(fields) < 24:
            fields.append([match.group(1).strip(), match.group(2).strip()[:160]])
    return fields


def _badges(lines):
    """Codes set apart in large type, such as a circled "FF / 06" item badge: (code, rect)."""
    sizes = [size for text, size, _ in lines if len(text) >= 3]
    median = statistics.median(sizes) if sizes else 0
    found = []
    for text, size, rect in lines:
        match = SINGLE.fullmatch(text)
        if match:
            found.append((code_of(*match.groups()), size, rect))
    letters = [(t, s, r) for t, s, r in lines if LETTERS.fullmatch(t)]
    digits = [(t, s, r) for t, s, r in lines if DIGITS.fullmatch(t)]
    for text, size, rect in letters:
        for number, nsize, nrect in digits:
            if (abs((rect.x0 + rect.x1) / 2 - (nrect.x0 + nrect.x1) / 2) <= size * 1.5
                    and 0 < (nrect.y0 + nrect.y1) / 2 - (rect.y0 + rect.y1) / 2 <= size * 2.5):
                found.append((code_of(text, number), min(size, nsize), rect | nrect))
                break
    return [(code, rect) for code, size, rect in found if median and size >= median * 1.25]


def _gaps(words, low, high, minimum):
    gaps, cursor = [], low
    for a, b in sorted((w.x0, w.x1) for w, _ in words if w.x1 > low and w.x0 < high):
        if a > cursor:
            gaps.append((cursor, a))
        cursor = max(cursor, b)
    gaps.append((cursor, high))
    return [g for g in gaps if g[1] - g[0] >= minimum]


def _closest(gaps, target):
    return min(gaps, key=lambda g: (max(g[0] - target, target - g[1], 0), g[0] - g[1]))


def _panels(bounds, badges, words):
    """Side-by-side sheets on one page (for example two specification sheets printed on a
    landscape page), split at empty vertical gaps. Sheets printed several to a page are
    usually equal widths, so the gap nearest the equal split is used."""
    groups = []
    for rect in sorted((r for _, r in badges), key=lambda r: r.x0 + r.x1):
        if groups and (rect.x0 + rect.x1) / 2 - (groups[-1][-1].x0 + groups[-1][-1].x1) / 2 <= bounds.width * .25:
            groups[-1].append(rect)
        else:
            groups.append([rect])
    if len(groups) < 2:
        # A landscape page with a clear gutter down the middle holds two pages side by side.
        if bounds.width < bounds.height * 1.2 or not words:
            return [bounds]
        middle = bounds.x0 + bounds.width / 2
        gaps = _gaps(words, middle - bounds.width * .1, middle + bounds.width * .1, bounds.width * .015)
        if not gaps:
            return [bounds]
        best = _closest(gaps, middle)
        cut = (best[0] + best[1]) / 2
        return [fitz.Rect(bounds.x0, bounds.y0, cut, bounds.y1), fitz.Rect(cut, bounds.y0, bounds.x1, bounds.y1)]
    cuts = []
    for k, (left, right) in enumerate(zip(groups, groups[1:])):
        gaps = _gaps(words, max(r.x1 for r in left), min(r.x0 for r in right), bounds.width * .01)
        if not gaps:
            return [bounds]
        best = _closest(gaps, bounds.x0 + bounds.width * (k + 1) / len(groups))
        cuts.append((best[0] + best[1]) / 2)
    edges = [bounds.x0, *cuts, bounds.x1]
    return [fitz.Rect(a, bounds.y0, b, bounds.y1) for a, b in zip(edges, edges[1:])]


def _plain(line):
    """False for a line from a font without a usable character map (it extracts as gibberish)."""
    chars = line.replace(' ', '')
    if not chars:
        return True
    plain = sum(ch.isascii() and (ch.isalnum() or ch in '.,:;\'"()/&%+-_#@*!?[]=<>$') or ch in '–—‘’“”•°×²³½™®'
                for ch in chars)
    runs = sum(len(t) for t in line.split() if len(t) > 24 and not re.search(r'[/:._@-]', t))
    # Shifted encodings ("YMJ" for "the") lose most vowels; part numbers (with digits) are ignored.
    letters = ''.join(re.findall(r'[A-Za-z]', ' '.join(w for w in line.split() if not re.search(r'\d', w))))
    vowels = sum(c in 'aeiouyAEIOUY' for c in letters)
    return plain / len(chars) >= .9 and runs / len(chars) <= .3 and (len(letters) < 20 or vowels / len(letters) >= .18)


CONTROL = re.compile(r'[\x00-\x08\x0b-\x1f]')


def _wordlike(text):
    """Share of words that look like real words; -1 while control characters remain."""
    if CONTROL.search(text):
        return -1
    tokens = [t for t in text.split() if len(re.findall('[A-Za-z]', t)) >= 2]
    if not tokens:
        return 0

    def real(token):
        if re.search(r'\d[A-Za-z]{3,}', token):
            return False
        letters = re.sub('[^A-Za-z]', '', token)
        return letters.lower() in COMMON or .2 <= sum(c in 'aeiouyAEIOUY' for c in letters) / len(letters) <= .75
    return sum(map(real, tokens)) / len(tokens)


def _repair(line):
    """Undo a common broken font encoding in which characters are shifted down by 29
    ("WKH" for "the", control characters for spaces and slashes). A line that already has
    real spaces only gets its control characters decoded. Otherwise the line is unchanged."""
    # str.strip() would also drop \x1c-\x1f, which are encoded characters here.
    line = line.strip(' \t\r\n')
    # A digit directly followed by three letters ("3UHYHQWLRQ") is another sign of the shift.
    if not CONTROL.search(line) and (not re.search(r'\d[A-Za-z]{3,}', line) or _wordlike(line) == 1):
        return line
    shift = lambda ch: chr(ord(ch) + 29) if 3 <= ord(ch) <= 0x61 else ch
    options = [''.join(shift(ch) if ord(ch) < 0x20 else ch for ch in line).strip()]
    if ' ' not in line:
        options.append(''.join(map(shift, line)))
    best = max(options, key=_wordlike).strip()
    return best if _plain(best) and _wordlike(best) > max(_wordlike(line), 0) else line


def _legible(text):
    """Readable lines of text, and whether most of the text survived."""
    kept = '\n'.join(line for line in text.split('\n') if _plain(line) and not CONTROL.search(line))
    words = re.findall(r'[A-Za-z]{2,}', kept)
    if len(words) >= 40 and sum(w.lower() in COMMON for w in words) / len(words) < .02:
        kept = ''
    size = lambda t: len(re.sub(r'\s', '', t))
    return kept, size(kept) >= size(text) * .7


def read_page(page, number):
    # One text extraction per page, without image data.
    textpage = page.get_textpage(flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)
    lines = _lines(page, textpage)
    badges = _badges(lines)
    # Badge lettering is not part of the table rows beside it.
    words = [(r, w) for r, w in ((fitz.Rect(w[:4]) * page.rotation_matrix, w[4])
                                 for w in page.get_text('words', textpage=textpage))
             if not any(r.intersects(b) for _, b in badges)]
    full = _clean('\n'.join(text for text, _, _ in lines))
    centre = lambda r: fitz.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
    panels = []
    rects = _panels(page.rect, badges, words)
    for rect in rects:
        inside = [w for w in words if rect.contains(centre(w[0]))]
        panel_lines = [line for line in lines if rect.contains(centre(line[2]))]
        fields = _fields(inside)
        codes = [code for code, r in badges if rect.contains(centre(r))]
        codes += [code_of(*m.groups()) for label, value in fields if CODE_LABEL.match(label)
                  for m in [SINGLE.fullmatch(value.strip())] if m]
        # Largest distinct lines first; running page headers are removed across the document later.
        headings = list(dict.fromkeys(t[:120] for size, t in sorted(
            ((size, t) for t, size, _ in panel_lines
             if len(t) >= 4 and not SINGLE.fullmatch(t) and re.search('[A-Za-z]{3}', t) and _plain(t)),
            key=lambda c: -c[0])))[:5]
        text, readable = _legible(full if len(rects) == 1 else _clean('\n'.join(t for t, _, _ in panel_lines)))
        codes = list(dict.fromkeys(codes))
        block = (f'Fields:\n' + '\n'.join(f'{k}: {v}' for k, v in fields) + '\n\nText:\n' if len(fields) >= 3 else '') + text
        if not readable:
            block += '\n(Some text here could not be read reliably; use the page picture if it is attached.)'
        if len(rects) > 1:
            block = f'[Sheet {len(panels) + 1} of {len(rects)}' + (f' · {", ".join(codes)}' if codes else '') + ']\n' + block
        panels.append(dict(codes=codes, headings=headings, title=_field(fields, TITLE_LABELS)[:160],
                           brand=_field(fields, BRAND_LABELS)[:120], text=block,
                           chars=len(text), readable=readable))
    return dict(page=number, text='\n\n'.join(p['text'] for p in panels)[:PAGE_TEXT_CAP],
                chars=sum(p['chars'] for p in panels), readable=all(p['readable'] for p in panels),
                heading='', codes=list(dict.fromkeys(c for p in panels for c in p['codes'])),
                panels=[{k: p[k] for k in ('codes', 'headings', 'title', 'brand')} for p in panels],
                mentions=sorted(find_codes(full)), section=[])


def _field(fields, patterns):
    for pattern in patterns:
        for label, value in fields:
            if pattern.match(label):
                return value
    return ''


def index_spec(path, filename):
    data = Path(path).read_bytes()
    pages = []
    with PDF_LOCK:
        doc = fitz.open(stream=data, filetype='pdf')
    try:
        with PDF_LOCK:
            if not doc.is_pdf:
                raise ValueError('The uploaded file is not a valid PDF.')
            if doc.needs_pass:
                raise ValueError('Upload an unlocked PDF.')
            count = len(doc)
        if not 1 <= count <= MAX_PAGES:
            raise ValueError(f'The specification must contain 1–{MAX_PAGES} pages.')
        for i in range(count):
            # Released between pages so drawings stay viewable while a long file is read.
            with PDF_LOCK:
                pages.append(read_page(doc[i], i + 1))
    finally:
        with PDF_LOCK:
            doc.close()
    # Lines repeated on many pages are page headers, not headings.
    seen = Counter(h for page in pages for h in {h for panel in page['panels'] for h in panel['headings']})
    running = {h for h, n in seen.items() if n >= max(3, len(pages) * .2)}
    for page in pages:
        for panel in page['panels']:
            panel['heading'] = next((h for h in panel.pop('headings') if h not in running), '')
        page['heading'] = next((p['heading'] for p in page['panels'] if p['heading']), '')
    # Pages without their own item code belong to the item before them.
    current, run = [], 0
    for page in pages:
        if page['codes']:
            current, run = page['codes'], 0
        elif current:
            run += 1
            if run > CONTINUATION_LIMIT:
                current = []
        page['section'] = list(page['codes'] or current)
    items = {}
    for page in pages:
        for code in page['section']:
            item = items.setdefault(code, dict(code=code, title='', brand='', pages=[], starts=[]))
            item['pages'].append(page['page'])
            if code in page['codes']:
                item['starts'].append(page['page'])
                panel = next(p for p in page['panels'] if code in p['codes'])
                if not item['title']:
                    item['title'] = panel['title'] or panel['heading']
                    item['brand'] = panel['brand']
    return dict(version=VERSION, filename=Path(filename).name[:200], hash=hashlib.sha256(data).hexdigest(),
                page_count=len(pages), uploaded=int(time.time() * 1000), pages=pages,
                items=list(items.values()), item_count=len(items),
                blank_pages=sum(1 for p in pages if p['chars'] < MIN_TEXT or not p['readable']))


def summary(index):
    return {k: index[k] for k in ('filename', 'hash', 'page_count', 'uploaded', 'item_count', 'blank_pages')}


def _stats(index):
    if index['hash'] not in _STATS:
        docs = [Counter(terms(p['heading'] + '\n' + p['text'])) for p in index['pages']]
        df = Counter()
        for counts in docs:
            df.update(counts.keys())
        lengths = [sum(c.values()) for c in docs]
        _STATS.clear()
        _STATS[index['hash']] = (docs, df, lengths, (sum(lengths) / len(lengths)) or 1)
    return _STATS[index['hash']]


def _page_span(pages):
    return f'p.{pages[0]}' if len(pages) == 1 else f'p.{pages[0]}-{pages[-1]}'


def _code_marks(lines):
    """Codes printed as their own label: "FF 06" on one line, or "FF" above "06" in a bubble."""
    marks = []
    used = set()
    for k, (text, size, rect) in enumerate(lines):
        match = SINGLE.fullmatch(text)
        if match:
            marks.append((code_of(*match.groups()), rect))
            used.add(k)
    for k, (text, size, rect) in enumerate(lines):
        if not LETTERS.fullmatch(text):
            continue
        for m, (number, nsize, nrect) in enumerate(lines):
            if (m not in used and DIGITS.fullmatch(number)
                    and abs((rect.x0 + rect.x1) / 2 - (nrect.x0 + nrect.x1) / 2) <= size * 1.5
                    and 0 < (nrect.y0 + nrect.y1) / 2 - (rect.y0 + rect.y1) / 2 <= size * 2.5):
                marks.append((code_of(text, number), rect | nrect))
                used.update((k, m))
                break
    return marks, used


def drawing_codes(drawing_path, page_number, index):
    """Codes on a drawing sheet: how often each is printed, the words printed right beside it,
    and the matching specification item. A code printed once or twice with words beside it is
    usually a legend entry or detail title; one printed many times is usually a plan callout."""
    items = {item['code']: item for item in index['items']}
    prefixes = {code.split('-')[0] for code in items}
    with PDF_LOCK, fitz.open(drawing_path) as doc:
        page = doc[page_number - 1]
        lines = _lines(page, page.get_textpage(flags=fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES))
    marks, used = _code_marks(lines)
    found = {}
    for code, bubble in sorted(marks, key=lambda m: (m[1].y0, m[1].x0)):
        if code.split('-')[0] not in prefixes:
            continue
        entry = found.setdefault(code, dict(code=code, times_printed=0, printed_beside=[]))
        entry['times_printed'] += 1
        # Words starting just right of the label, level with it.
        size = max(bubble.width, bubble.height)
        beside = sorted((rect.y0, rect.x0, text) for k, (text, _, rect) in enumerate(lines)
                        if k not in used and bubble.x1 - 1 <= rect.x0 <= bubble.x1 + size * 1.2
                        and bubble.y0 - size * .3 <= (rect.y0 + rect.y1) / 2 <= bubble.y1 + size * .3
                        and re.search('[A-Za-z]{3}', text))
        words = ' / '.join(text for _, _, text in beside[:3])[:200]
        if words and words not in entry['printed_beside'] and len(entry['printed_beside']) < 3:
            entry['printed_beside'].append(words)
    for code, entry in found.items():
        item = items.get(code)
        entry['in_specification'] = bool(item)
        if item:
            entry['specification_item'] = ' · '.join(filter(None, [item['title'], item['brand'], _page_span(item['pages'])]))
    return sorted(found.values(), key=lambda e: e['code'])


def select_spec(index, path, sheet_text, question, history=(), drawing=None):
    """Choose specification pages for one question. Local and deterministic."""
    known = {item['code'] for item in index['items']}
    question_codes = find_codes(question) & known
    sheet_codes = find_codes(sheet_text) & known
    weights = Counter()
    for t in terms(question):
        weights[t] = 1
    earlier = [turn['content'] for turn in history if turn.get('role') == 'user'][-2:]
    for t in terms(' '.join(earlier)):
        weights[t] = max(weights[t], .5)
    docs, df, lengths, avg = _stats(index)
    pages, n = index['pages'], len(index['pages'])
    scored = []
    for i, page in enumerate(pages):
        score = 0.0
        for t, weight in weights.items():
            tf = docs[i].get(t, 0)
            if tf:
                idf = math.log(1 + (n - df[t] + .5) / (df[t] + .5))
                score += weight * idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * lengths[i] / avg))
        section, own = set(page['section']), set(page['codes'])
        if section & question_codes:
            score += 40 + (15 if own & question_codes else 0)
        # Codes on the drawing rank pages the question is about; a vague question gets only the item list.
        if score and section & sheet_codes:
            score += 6 if own & sheet_codes else 2
        if set(page['mentions']) & question_codes:
            score += 4
        if score > 0:
            scored.append((score, i))
    scored.sort(key=lambda s: (-s[0], s[1]))
    chosen, used = [], 0

    def add(i):
        nonlocal used
        size = min(len(pages[i]['text']), EXCERPT_CAP)
        if i in chosen or len(chosen) >= MAX_EXCERPTS or used + size > EXCERPT_BUDGET:
            return False
        chosen.append(i)
        used += size
        return True

    floor = scored[0][0] * .25 if scored else 0
    for score, i in scored:
        if score < floor or len(chosen) >= MAX_EXCERPTS:
            break
        if add(i) and pages[i]['codes']:
            for j in range(i + 1, min(i + 1 + FOLLOW_PAGES, n)):
                if pages[j]['codes'] or pages[j]['section'] != pages[i]['section']:
                    break
                add(j)
    chosen.sort()
    first = sorted(index['items'], key=lambda item: (
        0 if item['code'] in question_codes else 1 if item['code'] in sheet_codes else 2, item['pages'][0]))
    rows, size, truncated = [], 0, False
    for item in first:
        row = ' · '.join(filter(None, [item['code'], _page_span(item['pages']), item['title'], item['brand']]))
        if size + len(row) > INDEX_BUDGET:
            truncated = True
            break
        rows.append(row)
        size += len(row) + 1
    return dict(path=str(path), filename=index['filename'], page_count=index['page_count'],
                codes_on_drawing=sorted(sheet_codes), codes_in_question=sorted(question_codes),
                drawing_codes=drawing_codes(*drawing, index) if drawing else [],
                index=rows, index_truncated=truncated,
                excerpts=[dict(page=pages[i]['page'], codes=pages[i]['section'], text=pages[i]['text'][:EXCERPT_CAP])
                          for i in chosen],
                image_pages=[pages[i]['page'] for i in chosen
                             if pages[i]['chars'] < MIN_TEXT or not pages[i]['readable']][:MAX_IMAGE_PAGES])


def render_spec_pages(path, numbers):
    content = []
    for number in numbers[:MAX_IMAGE_PAGES]:
        with PDF_LOCK, fitz.open(path) as doc:
            page = doc[number - 1]
            scale = 1600 / max(page.rect.width, page.rect.height)
            png = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False).tobytes('png')
        content += [dict(type='text', text=f'Technical specification page {number} (picture; its text layer is missing or unreadable).'),
                    dict(type='image_url', image_url={'url': 'data:image/png;base64,' + base64.b64encode(png).decode()})]
    return content


def _find_quote(sheet, quote):
    tries = [quote, ' '.join(quote.split())]
    field = FIELD.match(' '.join(quote.split()))
    if field:
        tries.append(field.group(2))
    tries += [t.strip(' .,;:"\'') for t in tries]
    for text in dict.fromkeys(tries):
        if len(text) >= 4 and (hits := sheet.search_for(text)):
            return hits
    parts = [p.strip(' .,;:') for p in re.split(r'\n|\s{2,}|\s*[;•]\s*', quote) if len(p.strip(' .,;:')) >= 4]
    if len(parts) > 1:
        found = [sheet.search_for(p) for p in parts]
        if all(found):
            return [hit for hits in found for hit in hits]
    return []


def locate_spec_refs(path, refs):
    """Keep references to real pages and find their quotes; never trust the model's wording."""
    out = []
    with PDF_LOCK, fitz.open(path) as doc:
        for ref in refs[:8]:
            if not isinstance(ref, dict):
                continue
            page = ref.get('page')
            if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= len(doc):
                continue
            quote = str(ref.get('quote') or '')[:300].strip()
            match = SINGLE.fullmatch(str(ref.get('code') or '').strip())
            boxes = []
            if len(quote) >= 4:
                sheet = doc[page - 1]
                bounds = sheet.rect
                for hit in _find_quote(sheet, quote)[:6]:
                    rect = hit * sheet.rotation_matrix
                    boxes.append([max(0, min(1, v)) for v in (rect.x0 / bounds.width, rect.y0 / bounds.height,
                                                              rect.x1 / bounds.width, rect.y1 / bounds.height)])
            out.append(dict(page=page, code=code_of(*match.groups()) if match else '',
                            title=str(ref.get('title') or 'Specification')[:160], quote=quote,
                            boxes=boxes, verified=bool(boxes)))
    return out
