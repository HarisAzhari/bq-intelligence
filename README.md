# Drawing Atlas — upload-first AI directory

## Tender summary: three-document questions

Each project can now link a tender summary PDF alongside its drawing set and technical
specification. Add it through **Add tender summary PDF** in the sidebar or project overview.
Upload and match review run locally with no model request. Questions use the existing paid
AI connection and streaming flow.

The tender index preserves each recognized table row's original wording, page, source
rectangle, item number, material code, description, unit, quantity, rate, amount and location
where those columns exist. It recognizes English column headings. Values stay as printed.
Unrecognized layouts fall back to text blocks requiring review; commercial columns are not
guessed. Image-only scans are reported as unreadable: this feature does not add OCR. A
searchable PDF is needed for extraction. Always compare extracted rows with the source.

Matching has two paths in the same system:

- **Confirmed automatically:** one exact code plus compatible specification-title wording,
  with no detected dimension, colour, application or finish conflict.
- **Suggested / ambiguous:** description overlap, incomplete extraction, uncertain identity,
  or multiple codes. These remain untrusted relationships until reviewed.
- **Conflict:** a printed code matches but available descriptions or attributes disagree.
- **Unmatched:** no candidate, no coded specification, or a reviewer explicitly left it unmatched.

Suggestions currently compare the description with coded specification item titles. Available
dimensions, colour, application and finish help flag conflicts; these are conservative rules,
not an exhaustive comparison of every specification property. Brand, location and units are
not independent reliable identifiers across all three files. Match reasons are shown instead
of an uncalibrated confidence percentage. Materials use the existing specification codes;
there is no duplicate master material database.

In **Review matches**, search/filter rows and use **View source row** to inspect the PDF.
Expand **Review / choose materials** or **Change link** to choose one or more specification
items. **Confirm selected** saves the relationship. **Leave unmatched** overrides automatic
matching. **Reset to automatic** removes that override. Multiple selected codes describe a
grouped row; its quantity is never automatically split or counted once per code. Printed
codes found on other drawing pages are listed as text occurrences, not proof of installation.

Questions still use only the selected drawing sheet. The server adds relevant tender rows
and specification excerpts. Confirmed tender links can help retrieve the corresponding
specification pages. Unconfirmed rows can be discussed as tender entries, but must not be
presented as established matches. `[Tender rN]` citations and **From the tender summary**
cards open the source page with the extracted row highlighted. Quoted text is checked against
the supplied row. Prices and quantities belong to that row, not automatically to the selected
drawing or an individual material in a group.

Replacing/removing documents or editing matches changes answer context. Old conversations
remain readable; outdated tender citations stop opening, and repeated questions offer a
saved-answer/new-answer choice instead of silently reusing old evidence. Replacing a PDF
with identical bytes preserves decisions. Replacing the specification makes manual decisions
require review again. Index/matcher versions also participate in context identity.

### Try the feature

1. Run `stop.bat`, then `start.bat`, and refresh http://127.0.0.1:8000
   (Ctrl+F5 if the new controls do not appear). Open your existing project.
2. Ensure the technical specification is linked. Choose **Add tender summary PDF** and
   select your tender PDF. Check the extracted row count and any extraction warnings.
3. Open **Review matches**. Find a material code shared by your documents. Expect a
   compatible exact-code row to be confirmed; click **View source row** and verify the
   description, unit, quantity, rate and amount against the PDF.
4. Find a row without a code. Expect a suggestion, ambiguity or unmatched status. Choose
   its correct specification material and press **Confirm selected**. Close/reopen review
   (or refresh the browser) and verify that the reviewed link persists.
5. Open a drawing through **Ask drawings**. Ask, replacing FF-06 with a real code:
   “Compare FF-06 across this drawing, the technical specification and the tender summary.
   Quote its tender quantity and unit, and identify any conflicts.” This step uses AI credits.
   Check the tender and specification citations against their source pages. A tender row total
   must not be presented as the quantity on this drawing without supporting evidence.
6. Repeat the identical question immediately. With unchanged context, expect **Saved answer
   reused, no extra cost**.
7. Return to review, change that row to **Leave unmatched**, then reopen the conversation.
   Expect the old tender citation to be marked outdated. Repeat the question: expect the
   saved/new choice. **Get a new answer** must describe the missing confirmed relationship.
8. Confirm the correct match again. Try a grouped row or conflicting description: it should
   need review and must not divide its quantity automatically.
9. To check replacement/removal, use a test project or keep your original PDF available.
   Replace the tender with a different PDF, or remove it. Old chat text should remain and
   tender citations should become outdated. New questions should reflect the current files.

The feature is verified with synthetic PDFs, API tests and a mocked-AI browser walkthrough.
Real tender layouts and model-generated answers still need the source checks above.

### Files and tests

New source files: `backend/tender.py`, `frontend/tender.js`, `frontend/tender.css`,
`tests/test_tender.py`. Integrations are in `backend/main.py`, `backend/chat.py`,
`frontend/chat.js`, and `frontend/index.html`.

Runtime data stays under the existing `data/<project-id>/` directory: `tender.pdf` is the
source, and `tender.json` holds extracted rows and reviewed relationships. Existing
`chats.json`/`answers.json` retain tender citations and context identities. No new database
or dependency is required. Use the app's **Remove** action to remove a tender attachment.

Run offline regression checks from the project directory:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check frontend/tender.js
node --check frontend/chat.js
```

Tests use temporary projects and mocked AI responses; they do not read or modify your
saved project documents or make paid requests.

## Ask about one sheet

Choose **Ask drawings** in navigation and open a sheet, or open any drawing and
select **Ask AI about this drawing** beside it. Both open a full-screen question page
with the drawing on the left and the conversation on the right; **Back** or the browser's
Back button returns to where you were. The assistant receives only that physical
page's extracted text, full image and enlarged title-block strips. It cannot consult
other sheets. Choose an image-capable OpenRouter model in AI settings.

Each new answer (**Ask** or Enter) makes a paid request. Suggested questions only fill in the
question box. No request runs merely by opening the question page.
Source regions highlight matched text or AI-proposed visual areas. Missing or repeated
text falls back to the full sheet. Conversations are separate per project and page,
saved in browser storage, and listed below Ask drawings for the current project.
Clearing browser data removes saved chats. Each answer shows reported input, output,
total tokens and cost under **Cost**, with conversation totals under **How it works**. Missing usage is shown as unavailable. Recent conversation (up to 20 messages) accompanies
follow-up questions. Failed requests retain your question for manual retry.

The endpoint is `POST /api/projects/{id}/pages/{page}/chat`. Chat does not modify
the directory or require completed directory generation. Answers can be mistaken;
check cited notes on the source drawing, especially small dimensions or symbols.

Run **start.bat**, then open http://127.0.0.1:8000. The first screen asks for a PDF. Nothing about the project's areas, room types, floors, disciplines or page layout is predefined.

## Use it

1. **Upload a PDF** using the drop zone or file chooser. Maximum 150 MB / 500 pages; encrypted PDFs must be unlocked first.
2. The PDF is saved and prepared locally, then generation stops at a confirmation screen. Review the active model in **AI settings** and select **Generate directory** when ready. Uploading never starts a paid OpenRouter request automatically.
3. Open **AI settings** and enter any OpenRouter model identifier, such as `openai/gpt-5.6-terra-pro`. Add an API key if one is not already configured. No restart is necessary when using this form. The backend saves only the key to `.env`; the model selection is kept in `data/settings.json`.
4. Select **Generate directory** for a prepared upload. AI analyzes the whole document and publishes the connected navigation.
5. Navigate from an overview or area to its work stages, elevations, plans and details. Filters derive their levels, disciplines, view types and stages from the generated data. Where multiple overview sheets exist, select the appropriate overview.
6. Open any sheet to see its source image, zoom, follow drawing references, inspect cited relationship evidence, or correct its classification. No per-sheet AI review is required.

Use **New project** to return to the upload screen. Saved projects and paused jobs are listed there. The previous manually prepared directory is preserved separately under **Previous manual prototype**. It is not used to interpret new PDFs and is not auto-opened.

## Navigation first

The active pipeline is `backend/navigation.py`. It sends the **complete PDF in one OpenRouter request**, together with native text labeled by physical page number. Its prompt describes the intended experience: overall plan → project area button → related work stages → plans, elevations, sections and details. Area names, stages and links must come from the uploaded document, not the old manual prototype.

The result is a compact directory, not 121 individual AI sheet reviews. Local validation requires exactly one record per physical page, valid area keys and valid overview/evidence page numbers. The existing directory UI displays the resulting buttons and source drawing pages immediately. There is no review gate or automatic per-page AI pass. Manual metadata editing remains optional.

OpenRouter's Mistral OCR file parser handles the whole attachment before model analysis. Its extracted text is preserved, but OpenRouter forwards at most eight OCR images. Consequently small graphical labels or image-only drawings can be missed; this flow does not promise exhaustive visual interpretation. Native PDF-capable models can be added as a separate route later. The old per-sheet implementation remains in `backend/ingestion.py` for shared utilities and legacy compatibility; directory generation uses `backend/navigation.py`.

## Cost and recovery

One normal generation makes one model request, with PDF parsing charges plus model token charges. Whole-document output can still take several minutes. The UI waits for the actual response instead of inventing page-level progress. Original PDFs and successful navigation responses are saved locally. Retries reuse a validated response for the same PDF, pipeline version and model. Failed or incomplete responses are not published and are not automatically retried. A failed request can still incur provider charges.

Pause takes effect after the in-flight document request returns. Restarting marks active jobs interrupted. The real key stays in `.env`; saving through settings updates the running backend immediately. There is no need to re-upload saved projects. Keep the backend running during generation.

See https://openrouter.ai/docs/guides/overview/multimodal/pdfs for parser behavior and https://openrouter.ai/deepseek/deepseek-v4.1-flash for current model pricing. Navigation accuracy has not been benchmarked.

## Run and stop

This machine already has `.venv` and runtime dependencies installed.

- Double-click **start.bat** to start or open this workspace's existing instance.
- Keep its terminal open, or use **stop.bat** to stop the verified workspace instance.
- On a fresh Windows machine the launcher runs **setup.ps1**. It finds Python 3.11+ on PATH or Codex's bundled Python and installs `requirements.txt`. No frontend build or Node installation is required.
- Model changes made through AI settings take effect without restart. Editing the API key in `.env` manually requires stop/start.

Manual launch:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Interactive API docs: http://127.0.0.1:8000/docs

## Files and endpoints

```text
backend/indexer.py       Generic local PDF preparation
backend/navigation.py    Whole-PDF navigation prompt, provider and validation
backend/ingestion.py     Shared validation utilities and legacy pipeline
backend/main.py          API, uploads, persistent jobs, configuration and reviews
frontend/app.js          Data-driven drawing directory and viewer
frontend/ingestion.js    Upload screen, connection form, progress and resume UI
data/<project-id>/       source.pdf, index.json, ingestion.json, AI cache, previews
```

- `POST /api/projects` — upload; automatically prepare and generate when configured.
- `GET /api/jobs/{id}` — persistent pipeline status.
- `POST /api/projects/{id}/generate` — start/resume an incomplete AI directory.
- `POST /api/projects/{id}/pause` — pause after current request.
- `PUT /api/config` — update backend key/model; no credential in the response.
- `GET /api/projects/{id}` — generated directory or clearly unfinished source index.
- `PATCH /api/projects/{id}/pages/{page}` — save reviewed metadata with history.
- `POST /api/projects/{id}/pages/{page}/analyze` — optional fresh single-sheet suggestion; does not overwrite reviewed metadata.
- `GET /api/projects/{id}/export` — JSON directory, links, evidence and history.

Backup `data/` to retain your sources and work. `.env`, PDFs, caches and local data are ignored by Git. Do not publish the local server: it is a single-user desktop prototype, bound to loopback, without multi-user authentication. Cross-origin browser mutations are rejected. Metadata writes are atomic and PDF operations share a lock. Fonts use Google Fonts with system fallbacks; no PDF content is sent for font loading.

OpenRouter structured-output documentation: https://openrouter.ai/docs/guides/features/structured-outputs

PyMuPDF is distributed under AGPL/commercial licensing; choose the appropriate arrangement before distributing a commercial product.


## Technical specification

Each project can have one technical specification ("how to work" PDF). Add it in the
sidebar under the project name (**Add how-to-work PDF**) or on **Project overview**;
both also offer Open, Replace and Remove. Once added, every sheet question uses it.

The file is read on this computer without any AI request: page text, item codes (for
example the circled `FF 06` badge), label rows such as `Product Type : …`, and pages
that hold two specification sheets side by side. Text from a common broken font encoding
(every character shifted, for example "WKH" for "the") is decoded; other unreadable text
is dropped, and those pages are counted as pictures.

For each question, the app picks the relevant specification pages locally and sends
only those with the drawing: at most 10 pages of text, a compact list of every coded
item, and at most two pictures of pages that cannot be read as text. Codes on the
drawing rank pages only when the question is about them, so a general question sends
just the item list. Limits live at the top of `backend/specs.py`.

Specification questions are answered with extra reasoning (`SPEC_REASONING` in
`backend/chat.py`) and strict rules: every fact must come from the drawing or the pages
sent, values are copied as printed, and anything the documents do not give is listed
under **Not covered by these documents** instead of being filled in. The app also sends a
summary of the codes printed on the drawing, read by position (legend words beside each
code, how often it is printed, and its specification item), so the answer can tell legend
entries from plan callouts. Disagreements between drawing and specification appear under
**Conflicts to resolve**. After each answer, measurements whose numbers appear nowhere in
the text that was read are listed under **Check before use**. Always confirm with the
designer before building.

Answers cite pages as **Spec p.N** tags and list **From the specification** cards; both
open the page beside the conversation with the quoted wording highlighted. Quotes that
cannot be found on the page are flagged. Replacing or removing the specification leaves
earlier answers readable, but their page links stop opening, and a repeated question
offers the saved answer or a new one. Indexes made by an older version are rebuilt in
the background when the server starts.

## Chat filters, storage and saved answers

Chats, usage, reply filters and colors are saved in `data/<project-id>/chats.json`.
Reusable responses are saved in `data/<project-id>/answers.json`. Existing browser
chats are imported when the project has no disk conversation for that page.

Use each answer's **Show on drawing** switch to select highlight groups and **Color**
to change its color. Each answer's **Where to look** cards show a close-up of each region;
hovering one brings its outline forward, and clicking one scrolls the drawing to it.
Dashed outlines are approximate AI regions. **Show all** restores all groups. The note above the question box shows
which answers guide the next question. Changing filters or colors makes no AI request.
AI regions remain approximate; manual drawing, resizing and citation auto-zoom have
been removed. Normal viewer zoom still works. The original PDF is unchanged.

The server reuses an immediately repeated question only when PDF, page, conversation,
model, normalized question, selected regions and preceding conversation match.
Capitalization and extra whitespace are ignored; paraphrases are not matched.
When earlier identical questions exist but scope, context or verification details differ,
the app offers **Use saved answer** or **Get a new answer** without sending an AI request. Color changes alone do not invalidate
reuse. **Always write a new answer** bypasses the cache. Reused replies show zero new
usage; the original reply retains its generation usage. Save status shows whether
changes reached the project. Filter controls are disabled while an answer or save
is in progress. Restart the backend and refresh the browser after upgrading.

Reused replies reference their original highlight group instead of creating new boxes.
The viewer draws identical saved page regions once, while keeping distinct regions separate.
Older replies without verification metadata require an explicit reuse choice.

## Streaming sheet answers

The question interface uses `POST /api/projects/{id}/pages/{page}/chat/stream`.
It shows preparation status, then answer text as OpenRouter produces it. Citation
locations, checks and usage are attached after completion; only completed answers
are saved. The existing JSON chat endpoint remains available. Streaming uses the
same single model request and retains saved-answer reuse.

Adding a specification identifies its role through the dedicated upload control,
then indexes it locally without sending an AI prompt. Each new question sends
selected excerpts and any selected images as input again. Specification questions
retain high reasoning effort, so there can still be a delay before answer text
starts. Streaming does not reduce input size or reasoning time.

Leaving the question view does not interrupt generation. If the network disconnects,
the server continues and saves a successful answer; reload the conversation before
retrying. Failed or truncated provider streams are not saved as completed answers
and are never automatically retried.

## Procurement: AI BOM and supplier sourcing

Restart the backend with `stop.bat` then `start.bat`, and refresh the browser.

### Walkthrough

1. Upload the drawing set and attach specification, tender summary and cost breakdown.
   Open **Procurement → Materials BOM → Generate AI BOM**. Confirm the credit notice.
   AI reads all attached PDFs, builds a draft, then cross-checks it against the originals.
   The UI shows the stage, elapsed time, heartbeat and cancellation control.
2. The successful BOM is saved. Viewing, refreshing, searching the table and restoring
   a saved version do not call AI. Material details are read-only. **View evidence**
   shows page links, exact source quotes, field confidence, conflicts and AI filter reasons.
   Unknown quantities, units or costs are not invented. Unresolved requirements block purchasing.
3. **Regenerate BOM** reuses an identical completed result by document hashes, model and
   prompt version. After a failed second pass it can reuse the saved draft. Check **Force
   a fresh analysis** only when you want new paid requests. Document changes mark the
   old BOM outdated; they do not silently trigger paid regeneration. Changed document sets
   require full analysis, not an incremental partial update. The previous BOM survives failures.
4. Open **Find suppliers → Find / resume suppliers** and confirm the credit notice.
   AI-selected location, company and currency filters come from cited document evidence;
   unknown filters stay unrestricted. Installation-inclusive budgets do not become price ceilings.
   Two material searches run at a time. Each result is saved immediately, with batch
   counts, elapsed time and heartbeat visible. Leaving the page does not cancel work.
5. Browse one row per material, 20 per page. Search material/company/contact, filter by
   result status, country or state, and expand only the matches you want to inspect.
   These are free display filters, not manual AI search settings. Candidate company
   coverage across multiple materials is summarized. Sourced public business email,
   telephone and city/state/country appear only when evidence is available.
6. Resuming reuses completed searches (including no-match outcomes) and retries failed
   or missing searches. Use **Refresh all supplier results** for a new paid search of
   saved no-match outcomes or old listings. Cancellation waits for in-flight provider
   requests; completed work is retained. A server restart marks jobs interrupted,
   never automatically retries them, and allows explicit resume.
7. Use **Visit supplier / buy** to continue on the supplier website, or record an actual
   verified quotation. Compare quotations, add to **Cart**, then create purchase orders.
   Existing approval, issue, supplier acknowledgement, partial delivery and printable
   purchase-order workflows remain. The app does not automatically send orders or pay.

### Accuracy and costs

BOM generation uses the configured OpenRouter key/model, with two AI calls plus PDF
parsing. Supplier discovery uses OpenRouter web search, up to two searches/eight results
per material request. Large BOMs can consume substantial credits. Reported usage/cost
is displayed when supplied; failed or cancelled in-flight calls may still be charged.
There is no automatic paid retry. No paid provider call is part of the offline tests.

AI confidence labels are qualitative, not measured accuracy. Exact quote matching checks
native PDF text and physical page numbers; it cannot prove semantic correctness. Scanned
or purely graphical evidence can be read by the provider but remains unverified locally,
so relevant requirements need attention. This is not guaranteed drawing takeoff.
Combined PDFs are limited to 100 MB and native text to 1.6 million characters; model
context limits may be smaller. Oversized requests fail visibly rather than silently
dropping pages. Different scopes/sizes must remain distinct; duplicate identities fail validation.

Supplier names, prices, locations and contacts require cited returned web evidence.
Unknown values remain unknown; listings do not prove stock, shipping coverage or current
pricing. No currency or pack conversion is performed. A web lead is not a verified quote.
Live model/tool compatibility still needs a user-triggered paid request.

Purchasing remains through a supplier website or manually shared purchase order:
there is no universal supplier checkout integration or automated payment. Local names
recorded for approvals are audit fields, not authenticated multi-user authorization.
Historical purchasing records remain preserved; stale quotations cannot be purchased.

### Files and saved data

```text
backend/bom.py               AI extraction, validation, source grounding and caching
backend/procurement_jobs.py  Background jobs, heartbeat, cancel/resume, supplier batching
backend/procurement.py       Procurement API, saved BOM, quotations, cart and orders
backend/suppliers.py         Cited web discovery and business contact validation
frontend/bom.js / bom.css    Read-only BOM, progress, versions and pagination
frontend/suppliers.js        Material-centric supplier table, filters and contact cards
frontend/procurement.js      Existing quotation, cart and order workflow
tests/test_procurement.py   Offline BOM/job/cache/purchasing regression tests
tests/test_suppliers.py     Offline supplier citation and contact tests
tests/bom_fixture.py        Synthetic PDF and AI response fixtures
tests/procurement_preview.py Isolated mocked browser-test server
tests/procurement_browser.cjs Headless Edge regression, including 105-material layout
data/<project>/bom.json            Current saved AI BOM
data/<project>/bom-history.json    Saved version index
data/<project>/bom-job.json        Persisted BOM progress
data/<project>/suppliers-job.json  Persisted supplier progress
data/<project>/supplier-results.json  Per-material saved search results
data/<project>/ai-cache/bom/       Draft checkpoints and versioned completed BOMs
data/<project>/ai-cache/suppliers/ Saved per-material search results
data/<project>/procurement.json   Preserved quotes, cart, orders and audit records
```

Back up the entire project data directory, including caches needed to restore saved
versions. Old manual material/review data is retained but is not used as the AI BOM.
No new application dependency is required.

From the project directory:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check frontend/bom.js
node --check frontend/suppliers.js
node --check frontend/procurement.js
```

Optional browser regression (existing Playwright and Edge required; do not install
dependencies just for this check): run `.venv\Scripts\python.exe tests/procurement_preview.py`
in one terminal, then `node tests/procurement_browser.cjs` in another. Set
`PLAYWRIGHT_MODULE` to the installed Playwright module path if necessary.
The isolated server binds localhost port 8001, uses temporary data and mocked providers.
Stop it with Ctrl+C after testing; temporary fixture data is cleaned up.
