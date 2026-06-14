# Project Status

Updated: 2026-06-11, Asia/Nicosia.

## Git

- Current branch: `codex/adk-chat-pipeline-refactor`
- Remote: `origin` -> `https://github.com/tuteishygpt/Agent-Yuzik.git`
- After `git fetch origin --prune`, the branch is aligned with `origin/codex/adk-chat-pipeline-refactor`.
- Latest commit: `3dbcb75 Add ADK TTS mode fallback`
- Working tree is not clean.

## Local Changes

Modified files:

- `api/chat.py`
- `bot/handlers.py`
- `services/adk_service.py`
- `services/chat_service.py`
- `tests/test_chat_persistence.py`
- `tests/test_chat_service.py`

Untracked files:

- `tests/test_adk_service_errors.py`

Current local work appears focused on hardening the chat and ADK pipeline:

- `ChatRequest` now supports `no_answer_reply`.
- `/api/chat` and Telegram message handling pass `DEFAULT_NO_ANSWER` as the no-answer fallback.
- `ChatService` detects an empty visible agent response and persists the fallback reply instead.
- `ADKService` detects ADK event-level errors and returns fallback events on the streaming path.
- Tests cover empty chat output fallback and ADK event error handling.

Git line-ending warnings are present: Git reports that LF will be replaced by CRLF when it next touches the modified Python files.

## Verification

Passed:

```powershell
python -m pytest tests/test_chat_service.py tests/test_chat_persistence.py tests/test_adk_service_errors.py -q
cd frontend
npx playwright test tests/e2e/adk2-chat-real-backend.spec.js --project=chromium
```

Result:

```text
16 passed, 6 warnings
ADK2 real-backend chat e2e: 1 passed (3.1m)
```

Warnings observed:

- `gotrue` package deprecation via Supabase dependency.
- `websockets.legacy` deprecation.
- FastAPI `on_event` deprecation in `app.py`.
- `pytest-asyncio` default fixture loop scope deprecation.

Not yet run in this status refresh:

- Full backend suite: `python -m pytest tests/ -v`
- Frontend tests: `cd frontend && npm test` or equivalent script check.
- Mobile tests/typecheck: `cd mobile && npm test`, `npx tsc --noEmit`
- Manual web, mobile voice, or Telegram smoke checks.

## Architecture Snapshot

The repository contains:

- FastAPI backend at project root and `api/`
- Business logic in `services/`
- Telegram bot handlers in `bot/`
- Vite web frontend in `frontend/`
- Expo/React Native mobile app in `mobile/`
- Supabase migrations and storage clients in `supabase/` and `services/supabase/`
- ADK/router agents in `router_agent/`, `google_search_agent/`, and `meme_generator_agent/`

Current dependency baseline still uses:

```text
google-genai>=1.52.0
google-adk>=1.21.0
```

The ADK 2 workflow migration plan exists at `docs/adk2-workflow-migration-plan.md`, but the implemented dependency state has not moved to `google-adk>=2.0,<3.0`.

## Open Items

- Decide whether to keep and commit the current no-answer/ADK event fallback changes.
- Run the full backend suite before commit or PR.
- Run `frontend/tests/e2e/adk2-chat-real-backend.spec.js` against the real backend after ADK2 chat/backend changes.
- Run frontend/mobile checks if the intended release scope includes those clients.
- Address or explicitly defer dependency deprecations.
- Consider normalizing line-ending behavior if CRLF churn becomes noisy.
