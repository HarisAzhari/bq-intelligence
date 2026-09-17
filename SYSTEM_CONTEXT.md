# Drawing Atlas: system context

## Tender summary extension

- `backend/tender.py` extracts recognized PDF table rows with exact printed fields and
  page rectangles; unknown layouts become review-required text blocks. Scanned pages are
  flagged, not OCRed. Matching reuses coded `spec.json` items rather than a second registry.
- One compatible exact code can auto-confirm identity. Description suggestions, grouped
  codes and detected conflicts require review. A manual decision can confirm several codes,
  leave a row unmatched, or reset it to automatic. Quantities remain owned by tender rows.
- `GET/POST/DELETE /api/projects/{id}/tender` reads/uploads/removes the attachment.
  `PATCH .../tender/rows/{row_id}` applies a decision with an expected context hash.
  `GET .../tender/pdf` and `GET .../tender/pages/{page}/image` expose original evidence.
  Image requests can supply `version` to reject a replaced source.
- `data/<project-id>/tender.pdf` and `tender.json` store source, row index and decisions.
  Decisions are tied to specification identity; changed specs require another review.
- The tender attachment is normally the tender DRAWING set: the same PDF as `source.pdf`.
  When `tender.hash` equals the drawing fingerprint, a row's page IS the sheet, so only the
  open sheet's own rows are supplied, complete and in printed order (`SHEET_ROW_LIMIT`,
  `TEXT_BUDGET`), and rows on other sheets are out of scope exactly as other drawings are.
  A genuinely separate tender document has no such correspondence, so it keeps whole-document
  relevance ranking (`ROW_LIMIT`). `TENDER_SHEET_SCOPE` / `TENDER_DOCUMENT_SCOPE` tell the model
  which it received, and therefore what a missing row means. Confirmed row codes can guide
  specification and cost retrieval. Only the selected drawing is supplied as drawing evidence.
- `tender_hash` and `tender_context` are saved on answers. Context covers tender hash,
  extraction version, matcher version, specification identity and all review decisions.
  Both generated cache keys and conversation-based reuse check this context. Old explicit
  answer reuse remains possible, with its original identity and outdated citations.
- `frontend/tender.js`/`tender.css` add upload, searchable/paginated review, grouped selection,
  source-page highlighting and citations. Overview controls remain available on small screens.
- `tests/test_tender.py` provides offline temporary-PDF/API/cache regressions. See the
  README's “Try the feature” section for the user acceptance walkthrough.

Attribution: made by Meeloiced sama

## Current status

This is a local, single-user PDF drawing-directory prototype with a selected-sheet
assistant. This snapshot is work in progress, not a verified stable release.

**Known issues reported by the user: highlight filters and saved-answer reuse are
still buggy.** Earlier mocked checks passed, but those checks did not establish
that the complete browser experience works correctly. Do not treat previous
implementation summaries as proof these issues are resolved.

## Intended workflow

1. Upload a drawing PDF and prepare its pages locally.
2. Confirm AI generation to build a project directory through OpenRouter.
3. Browse project areas, work stages and drawings.
4. Open a sheet and choose Ask AI about this drawing, or use Ask drawings in navigation.
   Both open the full-screen question page.
5. Ask questions using only the selected physical sheet. Other sheets are outside
   the assistant's scope, even if the drawing references them.

## Features and implementation

- PDF preparation: `backend/indexer.py` extracts page text and dimensions.
- Directory generation: `backend/navigation.py` sends the whole PDF through
  OpenRouter with OCR and validates the returned navigation. The legacy pipeline
  in `backend/ingestion.py` is not the active directory-generation path.
- Sheet assistant: `backend/chat.py` sends the selected sheet's text, full image
  and enlarged title-block strips. It requests answers and source regions.
- Visual highlights: AI-proposed rectangles can surround drawing objects, while
  text matches can locate notes. AI regions are approximate and may be misplaced.
- Highlight UI: `frontend/chat.js` renders regions, groups them by reply, supports
  group selection and color choices, and displays the next question's scope.
  The question page is a full-screen dialog in `frontend/chat.js` (styles in
  `frontend/chat.css`) with its own zoom and pan. "Where to look" cards crop the
  sheet image around each region; clicking one scrolls to it and pulses it without
  changing zoom or filters. Suggested questions fill the box and never send.
- Removed controls: citation auto-zoom, manual marking, redraw, drag and resize.
  The viewer's ordinary zoom controls remain.
- Chat history: one conversation per project and physical page, listed below
  Ask drawings after opening its project. Browser history can be imported when
  that page has no saved server conversation.
- Usage: replies show reported input, output, total tokens and cost, plus totals.
  Missing provider values are unavailable, not assumed zero.
- Technical specification: one optional per-project PDF, added from the sidebar
  under the project name or on Project overview, and used for every question.
  `backend/specs.py` indexes it locally (page text, badge codes such as FF-06,
  label rows, side-by-side sheets, item sections; unreadable font text dropped).
  For each question it selects pages by question codes and words, boosted by
  codes on the drawing, and sends them with the drawing plus a position-based
  summary of the drawing's code labels. `backend/chat.py` uses high reasoning and
  strict evidence rules for these answers, asks for `[Spec p.N]` citations and
  `spec_refs` (checked against the PDF text), removes repeated drawing sources,
  and flags answer measurements not found in the text read (`unverified`).
  The question page shows specification pages in its left pane.
- Cost breakdown: a second optional per-project PDF (bill of quantities, schedule of rates or
  cost plan), added the same way and read by the same `backend/specs.py` indexer. Its pages are
  chosen per question like the specification's and sent as `cost_breakdown`. `COST_PROMPT` asks
  for `[Cost p.N]` citations and `cost_refs`, forbids calculating or re-rating, and forbids
  presenting a project-wide measured quantity as the amount shown on one drawing. Unlike the
  tender, a cost breakdown is a separate document, so it has no page correspondence with the
  drawings and is always searched whole.
- Answer reuse: the server checks normalized question text and saved context.
  Capitalization and extra whitespace are ignored; paraphrases are not matched.
  Matching answers should avoid a provider call and report zero new usage.
- Changed context: a previous matching question with different scope or verification
  details should offer Use saved answer or Get a new answer before a paid call.
- Reused highlights: reused replies reference the original group; identical saved
  boxes should render once. Nearby distinct boxes should remain separate.

These descriptions explain intended behavior and code responsibilities. In
particular, filters and answer reuse still require debugging in the actual UI.

## Storage and boundaries

- `data/<project-id>/source.pdf`: original uploaded PDF; never annotated in place.
- `data/<project-id>/index.json`: extracted pages and generated directory.
- `data/<project-id>/ingestion.json`: persistent generation status.
- `data/<project-id>/chats.json`: messages, usage, filters, colors and source regions.
- `data/<project-id>/answers.json`: saved provider answers.
- `data/<project-id>/spec.pdf`, `spec.json`, `spec-pages/`: linked technical
  specification, its local index and rendered page images.
- `data/<project-id>/cost.pdf`, `cost.json`, `cost-pages/`: linked cost breakdown, same
  shape and same local indexer.
- `data/settings.json`: selected OpenRouter model.
- `.env`: OpenRouter API key. Do not commit credentials or private project data.

Source PDFs, chat data, caches and keys are ignored by Git. Back up `data/` for
local work. This snapshot does not include a user's local project data.

## Important endpoints

- `POST /api/projects`: prepare an uploaded PDF.
- `POST /api/projects/{id}/generate`: explicitly start directory generation.
- `POST /api/projects/{id}/pages/{page}/chat`: request or reuse a sheet answer.
- `GET /api/projects/{id}/chats`: restore project conversations.
- `PUT /api/projects/{id}/pages/{page}/conversation`: save conversation preferences.
- `POST /api/projects/{id}/spec`: add or replace the project's technical specification (no AI).
- `DELETE /api/projects/{id}/spec`: remove it. `GET …/spec/pdf` and
  `GET …/spec/pages/{page}/image` serve the file and page images.
- `…/cost` mirrors every `…/spec` route. Both are served by one set of helpers in
  `backend/main.py` (`DOCS`, `store_doc`, `remove_doc`, `doc_file`, `doc_image`).

## Running

Use `start.bat` to launch and `stop.bat` to stop the workspace server. Restart the
backend and refresh the browser after code changes. The default local address is
http://127.0.0.1:8000.
