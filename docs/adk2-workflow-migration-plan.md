# Agent-Yuzik: ADK 2.0 Workflow Migration Plan for Codex with Subagents

## Purpose

Implement an ADK 2.0-native workflow around the existing `router_agent` without losing the behavior that already works well.

The migration must keep the current router logic useful, reduce accidental tool calls, support mixed tasks such as search plus TTS, and prepare the project for future tools without introducing an oversized architecture.

## Pre-flight: confirm ADK 2.0 API surface (BLOCKING)

The plan below assumes specific ADK 2.0 primitives. Before writing any production code, Subagent A must confirm the **real, importable** API in the installed `google-adk~=2.0` package. Documented primitives include `BaseNode`, `BeforeAgentCallback`, `AfterAgentCallback`, `RetryConfig`, `NodeInterruptedError`. Patterns like `@node` decorator, `Workflow` class, or `ctx.run_node()` may or may not exist — Subagent A must verify by inspecting the installed package and the `adk-python` v2 branch under `contributing/workflow_samples`.

Coordinator must not start C1 until Subagent A returns:

```text
- exact import paths (e.g. from google.adk.workflows import ...)
- exact way to define a graph (decorator? class subclassing BaseNode? builder?)
- exact way to pass state between nodes
- exact way to define a node that wraps an existing LlmAgent
- exact way to call a workflow through Runner.run / ADKService.run_agent
- exact compatibility status for Runner.run_agent_stream / live streaming with graph workflows
- a working code snippet from adk-python v2 contributing/ that proves the pattern
- if @node / ctx.run_node / Workflow do not exist as named — name the actual API
```

If the real API differs from this document, Coordinator updates the plan before C1. If graph workflows are not compatible with live streaming in the installed ADK 2 package, Coordinator must keep `run_agent_stream` on a streaming-compatible root agent and must not route live voice traffic through `YuzikWorkflow`.

If Subagent A reports that the installed ADK 2 package does not yet expose a usable graph workflow API (no `BaseNode`, no documented way to compose nodes, no working sample in `adk-python` v2 `contributing/`), abort the migration. Do not implement a hand-rolled graph runtime as a substitute — that defeats the purpose of moving to ADK 2 and creates a maintenance burden that the official runtime will eventually displace. Open a tracking note with the exact gaps and revisit when ADK ships the missing primitives.

## Target branch

Create one working branch:

```bash
git checkout codex/adk-chat-pipeline-refactor
git checkout -b codex/adk2-yuzik-workflow
```

Use one final PR, but structure the work into three checkpoint commits:

| Checkpoint | Commit message | Scope |
|---|---|---|
| C1 | `C1: add ADK 2 workflow foundation` | ADK 2 install, typed state schema, postprocess node, error fallback node, workflow shell |
| C2 | `C2: add workflow policy and route validation` | input policy node, route validation node, file validation, callback cleanup |
| C3 | `C3: move TTS and image to route-first workflow` | TTS post-action, image sub-workflow, final cleanup |

After every checkpoint, run:

```bash
pytest
npx jest
python -m uvicorn app:app --reload   # smoke test web /api/chat
# plus the channel checks listed in each checkpoint's Acceptance section
```

Do not continue to the next checkpoint until the current checkpoint is green.

## High-level architecture

```text
ChatService
  → ADKService
    → non-streaming path: Runner(root_agent=YuzikWorkflow)
      → input_policy_node
      → router_agent_node      (LlmAgent wrapped as a graph node)
      → route_validation_node
      → execute_primary_route  (only for routes that bypass router_agent.tools)
      → post_action_node       (TTS post-action when requested)
      → postprocess_node
      → error_fallback_node    (attached as fallback edge, not always-run)

    → streaming path: Runner(root_agent=StreamingRootAgent)
      → default: existing router_agent / legacy streaming-compatible root
      → only migrate to YuzikWorkflow if Subagent A proves graph workflows support the exact live streaming API used by api/voice_adk.py
```

The `router_agent` stays. In the non-streaming path, it is no longer the only root-control layer. It becomes the LLM reasoning node inside a workflow that handles policy, validation, post-actions, artifacts, and fallback behavior. In the streaming path, `router_agent` remains the safe default until workflow streaming compatibility is proven.

## Non-goals

Do not implement a full CapabilityRegistry in this migration.

Do not add a separate deterministic LLM classifier before `router_agent`.

Do not move all tools to route-first execution at once.

Do not duplicate the same guard logic in graph nodes and callbacks long-term.

Do not make `ChatService` responsible for workflow internals.

Do not introduce a separate WorkflowService layer.

## Design decisions

### 0. Split non-streaming and streaming execution unless proven otherwise

Graph workflows are the target for normal text/chat execution, but live streaming is a separate compatibility surface. Subagent A must prove that the installed ADK 2 package supports graph workflows with the exact `run_agent_stream` / live voice path used by `api/voice_adk.py`.

Default implementation rule:

```text
ADKService.run_agent        → YuzikWorkflow
ADKService.run_agent_stream → existing router_agent or another streaming-compatible root
```

Only change `run_agent_stream` to `YuzikWorkflow` if a local smoke test proves live streaming compatibility. If not compatible, this split is intentional and must be documented in C1, C2, C3, and the final PR notes.

### 1. Keep `router_agent` and keep most of its tools as direct tools

`router_agent` already handles Belarusian language, ambiguous requests, humor, search decisions, and general chat reasonably well.

It remains an `LlmAgent` wrapped as a graph node. Decision split:

**1a. Direct tools inside router_agent (executed by LLM, results inline):**

```text
- get_weather
- lookup_verbum
- get_minsk_datetime
- search_agent (AgentTool)
- meme_agent (AgentTool)
```

These produce text results that flow back through `router_agent` and end up in `state.primary_text`.

**1b. NOT in router_agent.tools (executed by graph nodes):**

```text
- synthesize_speech       → triggered by post_action_node
- generate_image          → triggered by execute_image_workflow
```

This is the only architectural difference from today. router_agent no longer has access to TTS or image generation as tools. They are decided by graph nodes based on `state.tts_requested` / `state.image_requested`.

### 2. How `router_agent` emits a RoutePlan

router_agent does **not** use `output_schema=RoutePlan`. ADK disables tool use when `output_schema` is set, which would break decision 1a (we need weather/verbum/search as direct tools).

Instead:

```text
- router_agent runs normally with its allowed tools.
- Its final response text is captured into state.primary_text.
- post_actions are derived from state.tts_requested set by input_policy_node, not from router_agent's output.
- primary_route is derived from "did router_agent call a tool? which one?" by inspecting events emitted during the node's run.
```

`RoutePlan` therefore is **assembled by the workflow**, not produced by the LLM. The dataclass exists for typed state, not as an LLM output schema.

If a later iteration wants the LLM to emit RoutePlan as JSON, that becomes a separate route_planner_node added before router_agent. Out of scope for this migration.

### 3. Mixed requests: search + TTS

Example:

```text
"Знайдзі пра Купалу і прачытай уголас"
```

Flow:

```text
1. input_policy_node sets state.tts_requested = True
2. router_agent_node decides to call search_agent (or chat directly)
3. router_agent_node returns text into state.primary_text
4. route_validation_node accepts: tts_requested=True is permitted
5. post_action_node: state.tts_requested is True, runs synthesize_speech on state.primary_text
6. postprocess_node collects text + audio artifact
```

### 4. TTS rules

TTS runs via `post_action_node` only when `state.tts_requested=True` AND `state.primary_text` is non-empty AND `state.creation_cancelled=False`.

router_agent has no `synthesize_speech` tool, so accidental TTS from LLM is structurally impossible.

### 5. Image route-first requires explicit prompt translation

Current behavior relies on `router_agent` translating the Belarusian user request into an English image prompt before calling `generate_image`.

When `generate_image` is removed from `router_agent.tools`, translation moves into an explicit image sub-workflow:

```text
execute_image_workflow:
  → image_prompt_agent  (LlmAgent with output_schema=ImagePromptResult)
  → generate_image_tool (raw tool call with prompt_en)
  → emit caption_be from image_prompt_agent's output as primary_text
```

`image_prompt_agent` produces both fields in one LLM call:

```python
@dataclass
class ImagePromptResult:
    prompt_en: str
    caption_be: str
```

Note: there is no separate `image_caption_node`. `image_prompt_agent` returns both `prompt_en` (for the image tool) and `caption_be` (as the user-facing text), avoiding a second LLM round-trip.

`image_prompt_agent` must have no tools. `output_schema` and `tools` are mutually exclusive in ADK — setting `output_schema=ImagePromptResult` disables tool use. The agent only translates Belarusian → English prompt and produces a Belarusian caption in one structured output. Do not pass `tools=[...]` to it.

Routing to `execute_image_workflow` is decided by `route_validation_node` when `state.image_requested=True` AND `state.creation_cancelled=False`. In that case, `router_agent_node` is bypassed entirely for that turn.

Do not remove `generate_image` from `router_agent.tools` until `execute_image_workflow` is implemented and tested in C3.

### 6. Typed workflow state is mandatory

Create:

```text
yuzik_workflow/state.py
```

Use typed dataclasses instead of arbitrary string keys.

Core fields:

```python
from dataclasses import dataclass, field
from typing import Any, Literal

PrimaryRoute = Literal[
    "chat",
    "search",
    "weather",
    "verbum",
    "datetime",
    "meme",
    "image",
    "file_qa",
    "cancel",
    "fallback",
]

PostAction = Literal["tts"]

@dataclass
class RoutePlan:
    primary_route: PrimaryRoute
    args: dict[str, Any] = field(default_factory=dict)
    post_actions: list[PostAction] = field(default_factory=list)
    direct_answer: str | None = None
    confidence: float | None = None

@dataclass
class ExecutionResult:
    text: str | None = None
    parts: list[Any] = field(default_factory=list)
    artifact_delta: dict[str, int] = field(default_factory=dict)
    error: str | None = None
    error_type: str | None = None

@dataclass
class YuzikWorkflowState:
    user_id: str
    channel: str
    conversation_id: str
    session_id: str
    text: str | None

    language: str = "be"
    timezone: str | None = None
    minsk_time_enabled: bool = False

    tts_requested: bool = False
    image_requested: bool = False
    creation_cancelled: bool = False

    file_ok: bool = True
    file_error: str | None = None
    file_diagnostics: dict[str, Any] = field(default_factory=dict)

    primary_route: PrimaryRoute | None = None
    post_actions: list[PostAction] = field(default_factory=list)
    route_args: dict[str, Any] = field(default_factory=dict)
    route_confidence: float | None = None
    validation_errors: list[str] = field(default_factory=list)

    primary_text: str | None = None
    primary_parts: list[Any] = field(default_factory=list)
    artifact_delta: dict[str, int] = field(default_factory=dict)

    artifacts_collected: bool = False
    audio_url: str | None = None
    image_url: str | None = None

    error: str | None = None
    error_type: str | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)
```

### 7. Performance budget

Adding graph nodes adds overhead. Each checkpoint must measure end-to-end latency for two reference flows and document the result in the commit message:

```text
Reference A: "Прывітанне" (chat-only, no tool)
Reference B: "Знайдзі пра Купалу і прачытай уголас" (search + TTS)
```

Acceptable regression: median latency must stay within +20% of pre-migration baseline. Measured locally, single user, warm cache. If exceeded, Coordinator must investigate before continuing to next checkpoint.

Baseline must be captured **before** any code changes (Coordinator runs the two prompts on `main`, records timing). Prefer adding `scripts/bench_adk_workflow.py` in C1 so latency values are measured consistently instead of written by hand.

### 8. Channel coverage in acceptance

The migration touches `ADKService`, which is also used by:

```text
- api/telegram.py        → Telegram bot
- api/voice_adk.py       → mobile voice WebSocket (uses run_agent_stream)
- api/voice_simple.py    → simple voice fallback
- api/voice_teacher.py   → teacher mode voice
```

Subagent B must enumerate every caller of `ADKService.run_agent` and `ADKService.run_agent_stream` and report which channels each checkpoint's manual checks must cover. At minimum, every checkpoint manual section runs:

```text
- web /api/chat         (uvicorn + curl or browser)
- mobile voice WS round-trip   (npm start, single utterance)
- Telegram /chat        (one text message in a real chat)
```

If graph workflows are not live-streaming compatible, `run_agent_stream` must remain on `StreamingRootAgent` / existing `router_agent`. In that case, every checkpoint still verifies mobile voice WS, but marks it as:

```text
- streaming path intentionally not migrated to YuzikWorkflow
- streaming path still green on legacy-compatible root
- any behavior difference vs non-streaming workflow documented
```

Do not mark `run_agent_stream` as "not affected" merely because it remains on the legacy root; explicitly verify it still works after each `ADKService` change.

### 9. Session store and event schema migration

ADK 2.0 may extend event schema with `node_info` and `output` fields. Impact on `services/supabase/adk_session_store.py`:

```text
- If ADKSessionStore is only an active-session mapping (user → session_id), no change needed.
- If ADKSessionStore is a BaseSessionService subclass with rigid SQL columns for events, add node_info and output columns via a Supabase migration.
- If it stores events as JSON blob, no migration needed.
```

Subagent A reports which case applies. This is a hard C1 acceptance item, not optional documentation. If a Supabase migration is needed, it is part of C1 scope and goes into `supabase/migrations/` as a new sequential migration file. If no migration is needed, C1 must include a short note explaining why: active-session mapping only, JSON blob event storage, or no event persistence path affected.

## Subagent plan for Codex

Use Codex subagents explicitly for parallel read-heavy work and bounded implementation tasks. Do not use parallel subagents for simultaneous write-heavy edits in the same files.

### Round 1 (parallel, read-only)

#### Subagent A: ADK 2 API auditor

Investigate (see Pre-flight section for full output requirements):

- Real, importable ADK 2.0 graph API
- How nodes are defined and composed
- How an existing `LlmAgent` is wrapped as a node
- How state is passed between nodes
- Whether `Runner` accepts a workflow as `root_agent`
- Whether graph workflows are compatible with the exact `ADKService.run_agent_stream` / live voice code path
- If not compatible, the exact streaming-safe split to implement in `ADKService`
- Whether `ADKSessionStore` requires schema migration

Deliverable: a concrete code snippet that compiles against installed `google-adk~=2.0`, plus the list of corrections to apply to this plan.

#### Subagent B: Current code mapper

Inspect:

- `services/chat_service.py`
- `services/adk_service.py`
- `router_agent/agent.py`
- `tools/gemini_image_generator.py`
- `tools/text_to_speech_tool.py`
- `services/supabase/adk_session_store.py`
- all callers of `ADKService.run_agent` and `ADKService.run_agent_stream`
- existing tests under `tests/`

Output:

```text
- logic to move into input_policy_node
- logic to move into postprocess_node
- logic to move into error_fallback_node
- callbacks that overlap with future workflow nodes
- image prompt translation: where, how, what English text it produces
- search+TTS current behavior: does it work today? how?
- complete list of channels affected (web, telegram, voice_adk, voice_simple, voice_teacher)
- gemini_image_generator.py: does it accept Belarusian or English input today?
- text_to_speech_tool.py: input format, output format, channel constraints
```

### Round 2 (after A and B finish)

Coordinator updates the plan with confirmed API. Then:

#### Subagent C: Test planner

Read existing tests, propose skeleton tests **using the confirmed API from Subagent A**:

```text
test_yuzik_state_schema.py
test_input_policy_node.py
test_route_validation_node.py
test_post_action_tts.py
test_image_prompt_workflow.py
test_error_fallback_node.py
test_postprocess_node.py
test_adk2_workflow_integration.py
```

Must cover:

- no accidental TTS (LLM cannot produce audio because it has no TTS tool)
- no accidental image (LLM cannot produce image because it has no image tool)
- unsupported file blocks router with friendly message
- cancel blocks creation flows
- search plus TTS produces both text and audio
- Belarusian image request produces English prompt and Belarusian caption from one LLM call
- artifact_delta converts to ChatMedia
- timeout fallback
- generic error fallback
- existing voice WebSocket round-trip still works

Subagent C writes test **skeletons** in Round 2. Tests are filled in alongside implementation by Subagent D.

### Round 3 (sequential, write)

#### Subagent D: Implementation agent

Sequential write task. Implements C1, then C2, then C3.

For each checkpoint:

1. Read the checkpoint scope below.
2. Implement code and fill in the relevant test skeletons from Subagent C.
3. Run pytest, npx jest, manual channel checks from Section 8.
4. Capture latency for Reference A and Reference B (Section 7).
5. Commit with the prescribed checkpoint message.
6. Report status to Coordinator.

Do not edit route-first image until `execute_image_workflow` and `image_prompt_agent` are implemented and tested.

### Round 4 (after each checkpoint, read-only)

#### Subagent E: Review agent

Review:

- Accidental behavior changes vs `main`
- Duplicated policy between callbacks and nodes
- Whether `ChatService` became thinner
- Whether ADK 2 event schema implications are handled
- Whether tests are meaningful (not tautological)
- Latency regression vs baseline

Output:

```text
- blocking issues (must fix before next checkpoint)
- non-blocking issues (track for final cleanup)
- suggested fixes
```

## Checkpoint C1: Foundation

### Scope

Install ADK 2 and create workflow shell. User-visible behavior should not change beyond what ADK 2 itself changes.

Implement:

```text
yuzik_workflow/
  __init__.py
  state.py          → YuzikWorkflowState, RoutePlan, ExecutionResult
  root.py           → YuzikWorkflow definition (uses confirmed ADK 2 API)
  postprocess.py    → postprocess_node
  errors.py         → error_fallback_node
```

Update:

```text
requirements.txt              → google-adk>=2.0,<3.0
requirements-pre-adk2.txt     → snapshot of pre-migration pinned versions for emergency rollback
services/adk_service.py       → non-streaming Runner(root_agent=YuzikWorkflow) for run_agent
services/adk_service.py       → streaming Runner(root_agent=StreamingRootAgent/router_agent) for run_agent_stream unless workflow streaming is proven compatible
```

Do not replace the live streaming root with `YuzikWorkflow` by default. If Subagent A proves compatibility, include the proof snippet and smoke-test command in the C1 notes. If Subagent A does not prove compatibility, keep streaming on the existing root and document the intentional split.

If Subagent A reports a session store schema migration is needed:

```text
supabase/migrations/0005_adk2_event_schema.sql
```

Tests written in C1:

```text
tests/test_yuzik_state_schema.py     → state defaults, type round-trip
tests/test_postprocess_node.py       → artifact_delta → ChatMedia, mime classification
tests/test_error_fallback_node.py    → timeout, generic error, propagates request.error_reply
```

In C1, the workflow is a thin wrapper. It runs:

```text
input_policy_node (stub: copies request fields into state, no policy yet)
  → router_agent_node (wraps existing router_agent unchanged, including all current tools)
  → postprocess_node (real implementation)
```

`error_fallback_node` is wired as the workflow's error edge.

Error handling rules:

```text
- never catch BaseException
- never swallow NodeInterruptedError; let it propagate
- do not mask tool exceptions that ADK RetryConfig should handle
- fallback handles TimeoutError / configured timeout types and generic Exception only after retry policy is exhausted
- fallback may emit user-friendly text, but diagnostics must preserve original error_type and error message
```

`route_validation_node` and `post_action_node` exist as **no-op stubs** in C1; they become real in C2 and C3.

router_agent in C1 keeps `synthesize_speech` and `generate_image` in its tools — they are removed in C3, not C1.

### Acceptance checks

Automated:

```bash
pytest
npx jest
```

Manual (run all three):

```text
- web /api/chat:           normal chat, search, weather, Verbum, TTS, image
- mobile voice WS:         single voice round-trip (audio in → audio out)
- Telegram chat:           one text message produces correct reply
```

Streaming compatibility acceptance:

```text
- run_agent uses YuzikWorkflow
- run_agent_stream is explicitly verified:
  - either workflow-compatible with proof and smoke test, or
  - intentionally kept on StreamingRootAgent/router_agent
- mobile voice WS has no silent degradation
- any behavior difference between non-streaming workflow and streaming root is documented
```

Session/event schema acceptance:

```text
- ADKSessionStore storage mode confirmed
- if rigid event columns: node_info/output migration exists and tests pass
- if JSON blob or active-session mapping only: no-migration rationale documented
- clients tolerate additional ADK event fields without crashing
```

Latency:

```text
- Capture timing for Reference A and Reference B
- Compare to pre-migration baseline (captured before C1)
- Document in commit message
```

Behavior baseline:

```text
- TTS still works through router_agent.tools (unchanged in C1)
- image still works through router_agent.tools (unchanged in C1)
- artifacts still return to web and Telegram
```

Commit:

```bash
git add .
git commit -m "C1: add ADK 2 workflow foundation"
```

## Checkpoint C2: Policy

### Scope

Move pre-routing policy and route validation into workflow nodes.

Implement:

```text
yuzik_workflow/policy.py        → input_policy_node
yuzik_workflow/validation.py    → route_validation_node
```

`input_policy_node` does:

```text
- detect Belarusian/Russian/English language
- set state.minsk_time_enabled based on TIME_RELATED_PATTERN (moved from router_agent.agent)
- set state.tts_requested based on TTS_REQUESTED_PATTERN
- set state.image_requested based on IMAGE_REQUESTED_PATTERN
- set state.creation_cancelled based on CREATION_CANCEL_PATTERN
- inject Minsk time instruction into router_agent context when enabled
- run gemini_file_policy.validate_gemini_chat_file → set state.file_ok / file_error
- placeholder for rate/cost gating (no-op for now)
```

`input_policy_node` does not:

```text
- classify user intent
- choose tools
- translate image prompts
- decide which route to take
```

`route_validation_node` does:

```text
- if state.creation_cancelled=True: drop tts_requested and image_requested
- if state.file_ok=False: short-circuit to fallback path with file_error message
- mark state.primary_route based on what happened in router_agent_node (post-execution)
- accumulate state.validation_errors (informational)
```

In C2 `route_validation_node` does not yet route around router_agent for image — that lands in C3.

Callbacks:

```text
- enable_minsk_time_mode in router_agent: simplify to assume input_policy_node already populated state; keep it as a thin "read state, append instruction" callback
- guard_one_call: keep ONLY as safety net for unknown tool hallucination; do not duplicate tts/image guards (those will move out in C3 when tools leave router_agent)
- once C3 removes synthesize_speech/generate_image from router_agent.tools, the corresponding guard branches are deleted
```

Tests written in C2:

```text
tests/test_input_policy_node.py
tests/test_route_validation_node.py
```

### Acceptance checks

Automated:

```bash
pytest
npx jest
```

Manual:

```text
- "агучы гэта" sets tts_requested=True (verify via debug log or test endpoint)
- "намалюй ..." sets image_requested=True
- "не трэба, адмяні" sets creation_cancelled=True
- unsupported file (e.g. .exe upload) blocks router with friendly Belarusian message
- accidental TTS does not run for plain "прывітанне"
- accidental image does not run for plain "як справы"
- web /api/chat, mobile voice WS, Telegram all still work
- if run_agent_stream remains on legacy root, verify it still works and document it as intentional, not skipped
```

Latency:

```text
- Reference A and B captured, within +20% of C1 baseline
```

Commit:

```bash
git add .
git commit -m "C2: add workflow policy and route validation"
```

## Checkpoint C3: Route-first

### Scope

Move TTS and image generation out of `router_agent.tools` into graph nodes.

### TTS implementation

Add:

```text
yuzik_workflow/post_actions.py    → post_action_node
```

`post_action_node`:

```text
- runs after router_agent_node (or after execute_image_workflow)
- if state.tts_requested AND state.primary_text AND not state.creation_cancelled:
    - call synthesize_speech directly (raw tool, not via LLM)
    - append audio part to state.primary_parts
    - update state.artifact_delta
- otherwise: no-op
```

Once `post_action_node` is wired:

```text
- remove synthesize_speech from router_agent.tools
- remove the tts branch from guard_one_call callback
```

Supported examples:

```text
"Знайдзі пра Купалу і прачытай уголас"
  → input_policy: tts_requested=True
  → router_agent_node: calls search_agent, returns text
  → post_action_node: TTS on returned text

"Агучы гэты тэкст"
  → input_policy: tts_requested=True
  → router_agent_node: returns text directly (chat)
  → post_action_node: TTS on returned text
```

### Image implementation

Add:

```text
yuzik_workflow/image_workflow.py    → execute_image_workflow, image_prompt_agent
```

`execute_image_workflow`:

```text
1. image_prompt_agent (LlmAgent with output_schema=ImagePromptResult):
   - input: Belarusian user request from state.text
   - output: ImagePromptResult(prompt_en, caption_be)

2. generate_image tool (raw call, not via LLM):
   - input: prompt_en
   - output: image bytes → state.primary_parts, state.artifact_delta

3. caption_be is written to state.primary_text
   (no separate caption node; image_prompt_agent already produced both)
```

Routing:

```text
- route_validation_node: if state.image_requested AND not state.creation_cancelled:
    - bypass router_agent_node entirely
    - run execute_image_workflow instead
    - then post_action_node
- image + TTS in the same user turn is explicitly handled as:
    - generate image from prompt_en
    - set primary_text = caption_be
    - skip TTS by default unless a product decision explicitly enables caption narration
    - add diagnostics["tts_skipped_for_image"] = True when both flags were requested
```

Once `execute_image_workflow` is wired:

```text
- remove generate_image from router_agent.tools
- remove the image branch from guard_one_call callback
```

Tests written in C3:

```text
tests/test_post_action_tts.py
tests/test_image_prompt_workflow.py
tests/test_adk2_workflow_integration.py    → end-to-end with mocked LLM
```

### Acceptance checks

Automated:

```bash
pytest
npx jest
```

Manual (all three channels):

```text
- "знайдзі пра Купалу" → search only, no TTS
- "знайдзі пра Купалу і прачытай уголас" → search then TTS
- "агучы гэты тэкст" → TTS post-action
- "намалюй ката ў касманаўцкім шлеме" → English prompt visible in logs, image returned, Belarusian caption shown
- "адмяні" mid-conversation → no image/TTS even if previous turn requested them
- mobile voice WS: voice request "агучы прывітанне" still produces audio reply
- if mobile voice WS uses legacy streaming root, document whether TTS/image route-first behavior is available only on non-streaming chat
- Telegram: "/start" + image request returns image
```

Latency:

```text
- Reference A and B within +20% of pre-migration baseline (cumulative across C1+C2+C3)
- If exceeded, document where time is spent (which node)
```

Commit:

```bash
git add .
git commit -m "C3: move TTS and image to route-first workflow"
```

## Final cleanup

After C3:

```bash
pytest
npx jest
python -m uvicorn app:app --reload
```

Then inspect:

```bash
git diff main...HEAD
```

Final review checklist:

```text
- router_agent is still present and useful
- router_agent has no synthesize_speech or generate_image tools
- router_agent is no longer responsible for tts/image policy
- TTS can run after search/chat/verbum
- image prompt translation is explicit (image_prompt_agent)
- workflow state is typed (YuzikWorkflowState)
- ChatService is thinner (artifact collection moved to postprocess_node)
- callbacks are not duplicating graph node policy
- guard_one_call only guards against unknown-tool hallucination
- tests cover mixed routes and artifact postprocess
- voice WebSocket and Telegram bot still work
- latency within +20% of baseline
```

## Suggested Codex prompt

Use this prompt in Codex:

```text
You are implementing the ADK 2.0 workflow migration for Agent-Yuzik.

Use subagents for read-heavy analysis and test planning, but keep write-heavy code edits sequential.

ROUND 1 — spawn in parallel and wait for both:
1. Subagent A: ADK 2 API auditor (BLOCKING — produces real import paths, real graph API, code snippet that compiles)
2. Subagent B: Current code mapper (channels, image prompt location, callers of run_agent_stream)

After Round 1, update the plan with the confirmed ADK 2 API. Do not start C1 with assumed API names.

ROUND 2:
3. Subagent C: Test planner — writes test skeletons using the confirmed API

ROUND 3 — sequential implementation:
C1: Foundation (state schema, postprocess_node, error_fallback_node, workflow shell, optional Supabase migration)
C2: Policy (input_policy_node, route_validation_node, callback simplification)
C3: Route-first (post_action_node for TTS, execute_image_workflow with image_prompt_agent)

After each checkpoint:
- pytest
- npx jest
- manual checks on web /api/chat, mobile voice WS, Telegram chat
- capture latency for Reference A ("Прывітанне") and Reference B ("Знайдзі пра Купалу і прачытай уголас")
- Subagent E review

Do not start C3 until C1 and C2 are green.

Important constraints:
- Keep router_agent. Keep weather/verbum/search/datetime/meme as direct tools inside it.
- Do not add a separate LLM classifier.
- Do not implement a heavy CapabilityRegistry.
- Do not introduce a separate WorkflowService layer.
- RoutePlan is assembled by the workflow, not produced as LLM output_schema (router_agent must keep tool use).
- TTS must support search → TTS via post_action_node.
- Image route-first requires image_prompt_agent that emits {prompt_en, caption_be} in one LLM call.
- generate_image and synthesize_speech leave router_agent.tools only in C3, after their replacement nodes are tested.
- Use typed workflow state in yuzik_workflow/state.py.
- Do not duplicate policy in callbacks and workflow nodes long-term.
- Latency must stay within +20% of pre-migration baseline.
- Channels to verify: web /api/chat, mobile voice WS (api/voice_adk.py), Telegram (api/telegram.py).
- Do not route run_agent_stream through YuzikWorkflow unless Subagent A proves graph workflow live-streaming compatibility in the installed ADK package. Default split: run_agent → YuzikWorkflow; run_agent_stream → existing streaming-compatible router_agent/root.
- C1 must document ADKSessionStore event storage mode and either add node_info/output migration or explain why no migration is required.
- error_fallback_node must not catch BaseException or NodeInterruptedError and must not mask RetryConfig-managed exceptions before retries are exhausted.
```

## Rollback policy

If C1 fails:

```bash
git reset --soft HEAD~1
# fix ADK 2 install / runtime / Supabase migration / shell wiring
# do not proceed until pytest and manual smoke pass
```

If C2 fails:

```bash
git reset --soft HEAD~1
# keep C1 only; the system runs on the workflow shell with router_agent unchanged
```

If C3 fails:

```bash
git reset --soft HEAD~1
# keep C1+C2; TTS and image continue working through router_agent.tools as before
```

If pre-migration rollback is required:

```bash
pip install -r requirements-pre-adk2.txt
git checkout codex/adk-chat-pipeline-refactor
```

Rollback must not leave partially generated dependency files or schema migrations in the working tree. After rollback, run `git status --short` and remove any leftover generated files from the failed checkpoint.

## Done definition

The migration is complete when:

```text
- ADK 2 is installed intentionally (google-adk>=2.0,<3.0 in requirements.txt)
- YuzikWorkflow is root_agent for non-streaming `run_agent`
- `run_agent_stream` is either proven workflow-compatible or intentionally kept on a streaming-compatible root with documentation
- router_agent still works as LLM reasoning node, with weather/verbum/search/datetime/meme as direct tools
- router_agent no longer has synthesize_speech or generate_image
- input_policy_node owns intent flags and file validation
- route_validation_node owns cancel/file/route validation and image bypass
- post_action_node owns TTS post-action
- execute_image_workflow owns Belarusian-to-English prompt translation and image generation
- postprocess_node owns artifact collection and ChatMedia conversion
- error_fallback_node owns timeout and generic error fallback without swallowing NodeInterruptedError or RetryConfig-managed exceptions
- callbacks are safety net only (unknown tool hallucination)
- typed YuzikWorkflowState in yuzik_workflow/state.py
- tests pass (pytest, npx jest)
- web /api/chat, mobile voice WS, Telegram all verified manually
- latency within +20% of pre-migration baseline
- one final PR is ready with three checkpoint commits (C1, C2, C3)
```
