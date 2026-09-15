# Drawing Atlas — upload-first AI directory

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

DeepSeek stays selected for flow testing. OpenRouter's Mistral OCR file parser handles the whole attachment before model analysis. Its extracted text is preserved, but OpenRouter forwards at most eight OCR images. Consequently small graphical labels or image-only drawings can be missed; this flow does not promise exhaustive visual interpretation. Native PDF-capable models can be added as a separate route later. The old per-sheet implementation remains in `backend/ingestion.py` for compatibility tests and is not the production generation path.

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
tests/test_app.py        API and pipeline tests with simulated provider responses
tests/browser_fixture.py Isolated browser QA server; never used by start.bat
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

## Verification

```powershell
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -m pytest -q
Get-Content -Raw frontend/app.js | node --check
Get-Content -Raw frontend/ingestion.js | node --check
```

Tests cover arbitrary naming schemes, automatic upload-to-directory publication, scans, all page rotations, missing definitions, invented links, partial failures, checkpoint reuse, interruption, key handling and preservation of human corrections. Browser QA can use `python -m uvicorn tests.browser_fixture:app --port 8001`; this explicitly simulated provider is separate from production and makes no model calls.

OpenRouter structured-output documentation: https://openrouter.ai/docs/guides/features/structured-outputs

PyMuPDF is distributed under AGPL/commercial licensing; choose the appropriate arrangement before distributing a commercial product.
