# Drawing Atlas: system context

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
4. Open a sheet and choose Ask about this sheet, or use Ask drawings in navigation.
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
- Removed controls: citation auto-zoom, manual marking, redraw, drag and resize.
  The viewer's ordinary zoom controls remain.
- Chat history: one conversation per project and physical page, listed below
  Ask drawings after opening its project. Browser history can be imported when
  that page has no saved server conversation.
- Usage: replies show reported input, output, total tokens and cost, plus totals.
  Missing provider values are unavailable, not assumed zero.
- Answer reuse: the server checks normalized question text and saved context.
  Capitalization and extra whitespace are ignored; paraphrases are not matched.
  Matching answers should avoid a provider call and report zero new usage.
- Changed context: a previous matching question with different scope or verification
  details should offer Use previous answer or Generate fresh before a paid call.
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

## Verification and follow-up

Syntax and mocked checks covered disk restore, page isolation, usage handling,
duplicate-region handling, context changes and explicit answer reuse. No paid
provider calls were used during those checks. Full pytest execution was unavailable
in the workspace environment because pytest was not installed. Visual browser
verification remains outstanding.

Debug next with a real browser session and controlled provider responses:

1. Repeat a question before and after selecting highlight groups; inspect the
   actual saved scope, request and response without exposing credentials.
2. Confirm whether the request returns a reused answer, a choice, or a new call.
3. Check group ownership, visibility and colors after repeated replies, toggles,
   project switches and backend restarts.
4. Verify that failed preference saves are visible and that the UI reflects the
   server's actual scope.
5. Preserve isolation between different PDFs, physical pages and conversations.

Do not silently retry paid calls to diagnose these issues.

## Running

Use `start.bat` to launch and `stop.bat` to stop the workspace server. Restart the
backend and refresh the browser after code changes. The default local address is
http://127.0.0.1:8000. Tests are in `tests/test_chat.py`, `tests/test_app.py` and
`tests/test_navigation.py`.
