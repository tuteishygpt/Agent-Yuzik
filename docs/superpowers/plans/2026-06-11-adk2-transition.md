# ADK2 Transition Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Agent-Yuzik from the current ADK 1.x-style `router_agent` runner to an ADK 2 workflow-based execution path without breaking web chat, Telegram, voice streaming, artifacts, or Supabase session mapping.

**Architecture:** Keep `router_agent` as the Belarusian reasoning node, but move deterministic policy, validation, fallback, TTS post-actions, image prompt preparation, and artifact postprocessing into explicit ADK2 workflow nodes. Use ADK2 workflow runtime only after a local API audit confirms the exact installed import paths and streaming compatibility.

**Tech Stack:** Python 3.13 local environment, FastAPI, `google-adk`, `google-genai`, Supabase-backed metadata stores, pytest, Expo/Vite clients for channel smoke tests.

---

## Current Change Analysis

Baseline commit analyzed: `dccab0d Document status and harden chat fallbacks`.

The latest local changes are a good staging point before ADK2 because they make failure behavior explicit:

- `services/chat_service.py` added `ChatRequest.no_answer_reply` and `_has_visible_output()`.
- `api/chat.py` and `bot/handlers.py` now pass `config.DEFAULT_NO_ANSWER`.
- `services/adk_service.py` now detects event-level ADK errors via `error_code` / `error_message`.
- `run_agent_stream()` converts ADK event errors and runner exceptions into fallback `Event`s.
- `tests/test_adk_service_errors.py`, `tests/test_chat_service.py`, and `tests/test_chat_persistence.py` cover empty output and ADK event error fallback.
- `docs/project-status.md` records the project state and warns that ADK2 is not yet implemented.

Implications for ADK2:

- The no-answer fallback should become a `postprocess_node` responsibility, not remain only in `ChatService`.
- Event-level error detection is useful, but ADK2 adds native retry/error semantics; broad fallback catches should stay at service boundaries and must not mask node-level `RetryConfig`.
- `router_agent` currently owns too much policy through callbacks and tools: time mode, TTS intent, image intent, cancel, guard logic, TTS tool, and image tool.
- `ChatService` currently collects artifacts from ADK delta and direct parts. In ADK2, artifact collection should be extracted behind a reusable postprocess boundary so web, Telegram, and voice remain consistent.
- `ADKSessionStore` only stores active session mappings in `adk_sessions`; it does not persist raw ADK event rows. That likely means no ADK2 `Event.node_info` / `Event.output` Supabase migration is needed, but this must be re-confirmed during the API audit.

Important environment finding:

- Local package: `google-adk 1.2.1`.
- `requirements.txt`: `google-adk>=1.21.0`.
- ADK2 target: `google-adk>=2.0,<3.0`.
- The local environment currently does not match the written requirement. Fix dependency pinning before judging runtime behavior.

Official ADK2 facts checked on 2026-06-11:

- ADK Python 2.0 GA is documented as released on 2026-05-19: https://adk.dev/2.0/
- ADK2 introduces workflow runtime where agents, tools, and functions are evaluated as graph nodes: https://adk.dev/2.0/
- ADK2 adds `Event.node_info` and `Event.output`; rigid custom session schemas must be updated, JSON blobs usually do not: https://adk.dev/2.0/
- ADK2 changes `BaseAgent` execution because `BaseAgent` subclasses `BaseNode`; custom execution logic should move to callbacks: https://adk.dev/2.0/
- ADK2 dynamic workflows use `Workflow`, `@node`, and `ctx.run_node()`: https://adk.dev/graphs/dynamic/
- ADK2 graph workflows define routing through `edges` and route-valued `Event`s: https://adk.dev/graphs/routes/

## Target File Structure

Create:

- `yuzik_workflow/__init__.py` - package exports.
- `yuzik_workflow/state.py` - typed workflow state and route/result models.
- `yuzik_workflow/policy.py` - input policy node: time, TTS, image, cancel, file validation flags.
- `yuzik_workflow/router.py` - wrapper around existing `router_agent` and event/result extraction.
- `yuzik_workflow/validation.py` - route validation and short-circuit decisions.
- `yuzik_workflow/postprocess.py` - text fallback, artifact/part collection contract, diagnostics.
- `yuzik_workflow/errors.py` - user-facing fallback node and ADK2-safe error mapping.
- `yuzik_workflow/post_actions.py` - TTS post-action node.
- `yuzik_workflow/image_workflow.py` - image prompt agent and direct image generation node.
- `requirements-pre-adk2.txt` - rollback snapshot.
- `tests/test_yuzik_workflow_state.py`
- `tests/test_yuzik_policy.py`
- `tests/test_yuzik_validation.py`
- `tests/test_yuzik_postprocess.py`
- `tests/test_yuzik_errors.py`
- `tests/test_yuzik_post_actions.py`
- `tests/test_yuzik_image_workflow.py`
- `tests/test_adk2_service_integration.py`

Modify:

- `requirements.txt` - pin ADK2 range.
- `services/adk_service.py` - split non-streaming workflow runner from streaming-safe runner.
- `services/chat_service.py` - delegate postprocess/fallback behavior to reusable workflow output where possible.
- `router_agent/agent.py` - keep core Belarusian reasoning and direct text tools; progressively remove duplicated policy and then TTS/image tools.
- `api/voice_adk.py` - keep streaming path compatible and explicit.
- `api/deps.py` - instantiate the correct ADK service composition.
- `docs/project-status.md` - update after each checkpoint.

Do not modify until proven necessary:

- Supabase migrations. Add one only if the API audit proves ADK events are persisted into rigid columns.
- Mobile/web UI code. Run smoke checks, but migration should remain backend-first unless API contracts change.

## Chunk 1: Preflight Audit

### Task 1: Confirm ADK2 Runtime Surface

**Files:**
- Modify: `docs/project-status.md`
- Create: `tmp/adk2_api_audit.py` if useful, but do not commit `tmp/`

- [ ] **Step 1: Snapshot current dependency state**

Run:

```powershell
python -m pip show google-adk
python -m pip freeze | rg "google-adk|google-genai|pydantic|fastapi"
```

Expected: record the installed versions. Current known value is `google-adk 1.2.1`.

- [ ] **Step 2: Create rollback requirements**

Run:

```powershell
python -m pip freeze > requirements-pre-adk2.txt
```

Expected: file exists and includes current `google-adk` and `google-genai` versions.

- [ ] **Step 3: Install ADK2 in the working environment**

Run:

```powershell
python -m pip install "google-adk>=2.0,<3.0"
python -m pip show google-adk
```

Expected: installed version is `2.x`.

- [ ] **Step 4: Verify import paths with executable code**

Run:

```powershell
@'
from google.adk import Workflow, Context, Event
from google.adk.workflow import BaseNode, FunctionNode, JoinNode, RetryConfig, node
print("ADK2 workflow imports OK")
'@ | python -
```

Expected: prints `ADK2 workflow imports OK`.

- [ ] **Step 5: Verify runner constructor compatibility**

Inspect and run a minimal script that creates a `Workflow` with one `@node` function and passes it into `Runner`.

Expected: document whether the keyword is `agent=...`, `root_agent=...`, or both.

- [ ] **Step 6: Verify streaming compatibility**

Create a minimal workflow and run it through the same sync-to-async queue pattern used by `ADKService.run_agent_stream()`.

Expected: one of:

- Workflow events stream correctly and can be used for voice.
- Workflow events do not support the voice path; keep voice on the legacy `router_agent` runner.

- [ ] **Step 7: Verify session persistence impact**

Inspect whether `InMemorySessionService` remains sufficient and whether `ADKSessionStore` persists only active mappings.

Expected: record one clear statement in `docs/project-status.md`: "no Supabase event migration needed" or "migration needed because ...".

- [ ] **Step 8: Commit preflight**

Run:

```powershell
git add requirements-pre-adk2.txt docs/project-status.md
git commit -m "Audit ADK2 runtime surface"
```

## Chunk 2: Foundation Workflow

### Task 2: Add Typed State

**Files:**
- Create: `yuzik_workflow/state.py`
- Test: `tests/test_yuzik_workflow_state.py`

- [ ] **Step 1: Write state tests**

Test:

```python
def test_workflow_state_defaults_are_safe():
    state = YuzikWorkflowState(
        user_id="u1",
        channel="web",
        conversation_id="c1",
        session_id="s1",
        text="Прывітанне",
    )
    assert state.language == "be"
    assert state.tts_requested is False
    assert state.image_requested is False
    assert state.creation_cancelled is False
    assert state.primary_route is None
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
python -m pytest tests/test_yuzik_workflow_state.py -q
```

Expected: fails because module does not exist.

- [ ] **Step 3: Implement dataclasses**

Include `PrimaryRoute`, `PostAction`, `RoutePlan`, `ExecutionResult`, and `YuzikWorkflowState`.

- [ ] **Step 4: Run passing test**

Run:

```powershell
python -m pytest tests/test_yuzik_workflow_state.py -q
```

Expected: passes.

### Task 3: Add Postprocess Contract

**Files:**
- Create: `yuzik_workflow/postprocess.py`
- Modify: `services/chat_service.py`
- Test: `tests/test_yuzik_postprocess.py`, update `tests/test_chat_service.py`

- [ ] **Step 1: Write tests for visible output**

Cover:

- text counts as visible output.
- audio/image URLs count as visible output.
- web with only raw parts and no URL is not enough.
- non-web with media parts counts as visible output.
- empty output with `no_answer_reply` returns fallback text and `diagnostics["empty_response"] = True`.

- [ ] **Step 2: Extract `_has_visible_output()`**

Move the logic from `ChatService._has_visible_output()` into a workflow/postprocess helper while keeping the old method as a thin delegating wrapper during transition.

- [ ] **Step 3: Run tests**

Run:

```powershell
python -m pytest tests/test_yuzik_postprocess.py tests/test_chat_service.py -q
```

Expected: all pass.

### Task 4: Add Error Fallback Node

**Files:**
- Create: `yuzik_workflow/errors.py`
- Modify: `services/adk_service.py`
- Test: `tests/test_yuzik_errors.py`, `tests/test_adk_service_errors.py`

- [ ] **Step 1: Write tests for ADK event errors**

Keep the current behavior: event `error_code` / `error_message` maps to a controlled fallback at service boundary.

- [ ] **Step 2: Implement ADK2-safe fallback helper**

Rules:

- Do not catch `BaseException`.
- Do not catch or mask ADK2 interruption/HITL exceptions if exposed by installed ADK2.
- Let node/tool exceptions propagate inside workflow nodes so `RetryConfig` can work.
- Convert to user-facing fallback only at `ADKService` / channel boundary.

- [ ] **Step 3: Run tests**

Run:

```powershell
python -m pytest tests/test_yuzik_errors.py tests/test_adk_service_errors.py -q
```

Expected: all pass.

### Task 5: Wire Non-Streaming Workflow Shell

**Files:**
- Create: `yuzik_workflow/router.py`
- Create: `yuzik_workflow/__init__.py`
- Modify: `services/adk_service.py`
- Test: `tests/test_adk2_service_integration.py`

- [ ] **Step 1: Write integration test with mocked runner**

Test that `ADKService.run_agent()` returns the same tuple contract:

```python
reply, delta, parts = service.run_agent(
    session_id="s1",
    user_id="u1",
    text="Прывітанне",
)
```

- [ ] **Step 2: Add workflow shell using confirmed ADK2 API**

Use either:

```python
root_agent = Workflow(name="yuzik_workflow", edges=[("START", workflow_node)])
```

or the exact API found in Chunk 1.

- [ ] **Step 3: Keep streaming runner separate**

Keep `run_agent_stream()` on the existing streaming-compatible `router_agent` runner unless Chunk 1 proved workflow streaming compatibility.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
python -m pytest tests/test_adk2_service_integration.py tests/test_adk_service_errors.py tests/test_chat_service.py -q
```

Expected: all pass.

- [ ] **Step 5: Commit foundation**

Run:

```powershell
git add yuzik_workflow tests services/adk_service.py services/chat_service.py requirements.txt requirements-pre-adk2.txt
git commit -m "Add ADK2 workflow foundation"
```

## Chunk 3: Policy And Validation

### Task 6: Move Input Policy Out Of Router Callback

**Files:**
- Create: `yuzik_workflow/policy.py`
- Modify: `router_agent/agent.py`
- Test: `tests/test_yuzik_policy.py`

- [ ] **Step 1: Write policy tests**

Cover:

- time-related text sets `timezone="Europe/Minsk"` and `minsk_time_enabled=True`.
- TTS request sets `tts_requested=True`.
- image request sets `image_requested=True`.
- cancel text sets `creation_cancelled=True` and clears creation flags.
- unsupported file sets `file_ok=False` with a friendly message.

- [ ] **Step 2: Implement policy node**

Move regex use from `router_agent/agent.py` into `yuzik_workflow/policy.py`. Keep exported regex constants if existing tests import them.

- [ ] **Step 3: Thin `enable_minsk_time_mode()`**

During transition, keep callback only for appending Minsk instruction based on workflow/session state. Do not duplicate TTS/image/cancel policy long term.

- [ ] **Step 4: Run tests**

Run:

```powershell
python -m pytest tests/test_yuzik_policy.py tests/test_chat_service.py -q
```

Expected: all pass.

### Task 7: Add Route Validation

**Files:**
- Create: `yuzik_workflow/validation.py`
- Test: `tests/test_yuzik_validation.py`

- [ ] **Step 1: Write validation tests**

Cover:

- `creation_cancelled=True` clears TTS/image post-actions.
- `file_ok=False` short-circuits to file error text.
- router tool events map to route names: `search`, `weather`, `verbum`, `datetime`, `meme`, `chat`.
- validation errors are diagnostics, not user-visible crashes.

- [ ] **Step 2: Implement validation node**

Use event/tool-call metadata from the confirmed ADK2 event shape. If ADK2 event metadata differs from ADK1, isolate mapping in one helper.

- [ ] **Step 3: Run tests**

Run:

```powershell
python -m pytest tests/test_yuzik_validation.py tests/test_yuzik_policy.py -q
```

Expected: all pass.

- [ ] **Step 4: Commit policy chunk**

Run:

```powershell
git add yuzik_workflow tests router_agent/agent.py
git commit -m "Move chat policy into ADK2 workflow"
```

## Chunk 4: Route-First TTS And Image

### Task 8: Move TTS To Post-Action Node

**Files:**
- Create: `yuzik_workflow/post_actions.py`
- Modify: `router_agent/agent.py`
- Test: `tests/test_yuzik_post_actions.py`

- [ ] **Step 1: Write TTS post-action tests**

Cover:

- `tts_requested=True` and `primary_text` calls TTS once.
- search result plus TTS produces text and audio.
- plain chat does not call TTS.
- cancel prevents TTS.
- TTS failure records diagnostics without erasing primary text unless product behavior says otherwise.

- [ ] **Step 2: Implement direct TTS call**

Call the existing `synthesize_speech_tool` from deterministic code, not from the LLM tool list.

- [ ] **Step 3: Remove TTS from `router_agent.tools`**

Remove `synthesize_speech_tool` and delete the TTS branch from `guard_one_call` after tests prove replacement behavior.

- [ ] **Step 4: Run tests**

Run:

```powershell
python -m pytest tests/test_yuzik_post_actions.py tests/test_adk_tts.py tests/test_chat_service.py -q
```

Expected: all pass or `tests/test_adk_tts.py` is updated if it intentionally targeted old LLM-tool TTS behavior.

### Task 9: Move Image To Explicit Image Workflow

**Files:**
- Create: `yuzik_workflow/image_workflow.py`
- Modify: `router_agent/agent.py`
- Test: `tests/test_yuzik_image_workflow.py`

- [ ] **Step 1: Write image workflow tests**

Cover:

- Belarusian image request produces `prompt_en` and `caption_be`.
- `generate_image_tool` receives English prompt.
- image artifact/part is returned.
- image plus TTS skips TTS by default and records `diagnostics["tts_skipped_for_image"] = True`.
- cancel prevents image generation.

- [ ] **Step 2: Implement `ImagePromptResult`**

Use the confirmed ADK2 structured-output mechanism. If `output_schema` still disables tools, keep `image_prompt_agent` tool-free.

- [ ] **Step 3: Call image generation directly**

Run `generate_image_tool` from workflow code after prompt generation.

- [ ] **Step 4: Remove image generation from `router_agent.tools`**

Remove `generate_image_tool` and delete the image branch from `guard_one_call` after route-first image tests pass.

- [ ] **Step 5: Run tests**

Run:

```powershell
python -m pytest tests/test_yuzik_image_workflow.py tests/test_artifact_storage.py tests/test_chat_service.py -q
```

Expected: all pass.

- [ ] **Step 6: Commit route-first chunk**

Run:

```powershell
git add yuzik_workflow tests router_agent/agent.py
git commit -m "Move TTS and image generation into workflow routes"
```

## Chunk 5: Channel Verification And Cleanup

### Task 10: Full Automated Checks

**Files:**
- Modify: `docs/project-status.md`

- [ ] **Step 1: Run backend tests**

Run:

```powershell
python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 2: Run frontend checks**

Run:

```powershell
cd frontend
npm test
```

Expected: all pass, or document if no test script exists.

- [ ] **Step 3: Run mobile checks**

Run:

```powershell
cd mobile
npm test
npx tsc --noEmit
```

Expected: all pass, or document exact missing dependency/tooling issue.

### Task 11: Manual Channel Smoke Tests

**Files:**
- Modify: `docs/project-status.md`

- [ ] **Step 1: Web `/api/chat`**

Run backend:

```powershell
python -m uvicorn app:app --reload
```

Check:

- plain chat returns Belarusian text.
- search request returns text.
- weather request calls weather path.
- Verbum request calls dictionary path.
- TTS request returns audio.
- image request returns image.
- empty ADK output returns `DEFAULT_NO_ANSWER`.

- [ ] **Step 2: Mobile voice WebSocket**

Check one utterance end-to-end through `api/voice_adk.py`.

Expected:

- If streaming stayed legacy: document "streaming intentionally remains on router_agent".
- If workflow streaming was enabled: document proof and any behavior difference.

- [ ] **Step 3: Telegram**

Check:

- one text message.
- one TTS request.
- one image request if Telegram media path is in scope.

### Task 12: Latency Baseline

**Files:**
- Create: `scripts/bench_adk_workflow.py`
- Modify: `docs/project-status.md`

- [ ] **Step 1: Add benchmark script**

Measure warm-cache median latency for:

- `Прывітанне`
- `Знайдзі пра Купалу і прачытай уголас`

- [ ] **Step 2: Run before and after each major chunk**

Expected: cumulative regression stays within +20%, or the plan pauses for profiling.

### Task 13: Final Cleanup

**Files:**
- Modify: `docs/project-status.md`
- Modify: `docs/adk2-workflow-migration-plan.md` only if the old plan now conflicts with implementation.

- [ ] **Step 1: Remove duplicated policy**

Ensure `router_agent/agent.py` no longer owns TTS/image/cancel policy except for minimal compatibility callbacks.

- [ ] **Step 2: Check final diff**

Run:

```powershell
git diff main...HEAD --stat
git diff main...HEAD -- services/adk_service.py router_agent/agent.py yuzik_workflow
```

Expected: workflow boundaries are clear and unrelated churn is absent.

- [ ] **Step 3: Commit final status**

Run:

```powershell
git add docs/project-status.md docs/adk2-workflow-migration-plan.md scripts/bench_adk_workflow.py
git commit -m "Document ADK2 migration verification"
```

## Rollback

If ADK2 import/runtime audit fails:

```powershell
python -m pip install -r requirements-pre-adk2.txt
git restore requirements.txt
```

If foundation fails:

```powershell
git reset --soft HEAD~1
```

If route-first TTS/image fails after foundation works:

```powershell
git reset --soft HEAD~1
```

Do not leave `router_agent` without TTS/image tools unless workflow post-actions are tested and channel smoke checks pass.

## Done Criteria

- `requirements.txt` uses `google-adk>=2.0,<3.0`.
- Local environment reports `google-adk 2.x`.
- Non-streaming `ADKService.run_agent()` uses `YuzikWorkflow`.
- `run_agent_stream()` is either proven workflow-compatible or intentionally kept on legacy `router_agent`.
- `router_agent` keeps direct text tools: search, meme, Minsk datetime, weather, Verbum.
- TTS and image generation are not LLM-callable router tools.
- Input policy, validation, postprocess, error fallback, TTS post-action, and image workflow are explicit workflow modules.
- Supabase event migration decision is documented with evidence.
- `python -m pytest tests/ -v` passes.
- Frontend/mobile checks are run or exact blockers are documented.
- Web chat, mobile voice WebSocket, and Telegram are manually verified.
- Latency regression for the two reference prompts is within +20% or explicitly accepted with profiling evidence.
