# No-Regex Intent Classifier Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace natural-language regex routing with a structured LLM intent classifier while keeping the ADK 2 graph-based workflow.

**Architecture:** Keep `turn_context_node` as the first node and keep deterministic file validation. Add a cheap structured-output `intent_classifier_agent` that returns `TurnIntent`; add a deterministic `intent_policy_node` that maps `TurnIntent` to graph routes and state flags. Remove regex-based natural-language parsing from `yuzik_workflow/policy.py` and `router_agent/agent.py`.

**Tech Stack:** Python 3.13, `google-adk>=2.0,<3.0`, ADK `Workflow`, `LlmAgent` with `output_schema`, `google-genai`, pytest, Playwright e2e.

---

## Current Code Analysis

The current production workflow is defined in `yuzik_workflow/root.py`:

```text
START
  -> turn_context_node
  -> input_policy_node
      file_error -> error_fallback_node
      cancel     -> route_validation_cancel_node -> postprocess_cancel_node
      direct     -> direct_postprocess_node
      translate  -> translation_agent -> translation_postprocess_node
      image      -> image_prompt_agent -> execute_image_workflow -> image_post_action_node -> image_postprocess_node
      default    -> router_agent -> route_validation_node -> post_action_node -> postprocess_node
```

`yuzik_workflow/context.py` already builds `TurnContext` with:

- `current_content`
- `current_text`
- `previous_text`
- `previous_summary`
- `previous_artifact_id`
- `language`

`yuzik_workflow/policy.py` is still the natural-language routing bottleneck:

- imports regex patterns from `router_agent.agent`;
- defines translation regexes locally;
- detects TTS/image/time/cancel/translation with regex;
- validates files;
- stores `temp:turn_*` context;
- sets `ctx.route`.

`router_agent/agent.py` still contains regex patterns and `enable_minsk_time_mode()` also mutates state based on regex detection. After this migration, the router agent should not classify TTS/image/time/cancel; it should only answer default user requests and use tools when the route reaches it.

`yuzik_workflow/image_workflow.py` and `yuzik_workflow/translation.py` already consume structured previous context from state, so they should need only minor alignment with the new `TurnIntent` state keys.

## Target Graph

```text
START
  -> turn_context_node
  -> file_policy_node
      file_error -> error_fallback_node
      default    -> intent_classifier_agent
  -> intent_policy_node
      cancel     -> route_validation_cancel_node -> postprocess_cancel_node
      direct     -> direct_postprocess_node
      translate  -> translation_agent -> translation_postprocess_node
      image      -> image_prompt_agent -> execute_image_workflow -> image_post_action_node -> image_postprocess_node
      default    -> router_agent -> route_validation_node -> post_action_node -> postprocess_node
```

Important route rule: unsupported files must short-circuit before the classifier so invalid file turns do not spend an LLM call.

## File Structure

Create:

- `yuzik_workflow/intent.py` - `TurnIntent`, constants, coercion/validation helpers.
- `yuzik_workflow/file_policy.py` - deterministic file validation node.
- `yuzik_workflow/intent_classifier.py` - cheap `LlmAgent` classifier and prompt callback.
- `tests/test_intent_model.py` - focused schema/coercion tests.
- `tests/test_file_policy_node.py` - deterministic file-policy tests.
- `tests/test_intent_classifier_node.py` - classifier prompt/callback and graph-adjacent tests.
- `tests/test_intent_policy_node.py` - deterministic route/state mapping tests.

Modify:

- `yuzik_workflow/root.py` - insert `file_policy_node`, `intent_classifier_agent`, and `intent_policy_node`.
- `yuzik_workflow/policy.py` - reduce to intent application only, or rename its node to `intent_policy_node`.
- `router_agent/agent.py` - remove natural-language regex patterns and state mutation from `enable_minsk_time_mode`.
- `yuzik_workflow/translation.py` - read translation target/source from `TurnIntent` state.
- `yuzik_workflow/image_workflow.py` - no major behavior change; keep structured previous context.
- `tests/test_input_policy_node.py` - replace regex-routing tests with intent-policy tests or migrate assertions to `tests/test_intent_policy_node.py`.
- `tests/test_adk2_workflow_integration.py` - assert new graph edges.
- `frontend/tests/e2e/adk2-chat-real-backend.spec.js` - keep context e2e; update assertions only if needed.

Do not modify unless needed:

- Supabase migrations.
- Voice streaming path. It uses `router_agent` directly and is not graph-compatible today.
- TTS implementation internals, except tests may need state key updates if names change.

---

## Chunk 1: Intent Model

### Task 1: Add `TurnIntent`

**Files:**
- Create: `yuzik_workflow/intent.py`
- Create: `tests/test_intent_model.py`

- [ ] **Step 1: Write failing schema tests**

Cover:

- default values normalize to safe routing;
- invalid route coerces to `"default"`;
- invalid action names are dropped;
- confidence outside `[0.0, 1.0]` is clamped;
- missing target language is allowed;
- `needs_previous_context` is a boolean.

Example test shape:

```python
from yuzik_workflow.intent import TurnIntent, coerce_turn_intent


def test_coerce_turn_intent_defaults_invalid_route_to_default():
    intent = coerce_turn_intent({"route": "unknown", "actions": ["tts"]})

    assert intent.route == "default"
    assert intent.actions == ["tts"]
```

- [ ] **Step 2: Run RED**

Run:

```powershell
python -m pytest tests/test_intent_model.py -q
```

Expected: fails because `yuzik_workflow.intent` does not exist.

- [ ] **Step 3: Implement minimal model**

Add:

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


RouteName = Literal["default", "image", "translation", "direct", "cancel"]
ActionName = Literal["tts"]

VALID_ROUTES = {"default", "image", "translation", "direct", "cancel"}
VALID_ACTIONS = {"tts"}
DEFAULT_INTENT_CONFIDENCE_THRESHOLD = 0.6


@dataclass
class TurnIntent:
    route: RouteName = "default"
    actions: list[ActionName] = field(default_factory=list)
    target_language: str | None = None
    timezone: str | None = None
    needs_previous_context: bool = False
    confidence: float = 0.0
```

Add `coerce_turn_intent(value: Any) -> TurnIntent`.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
python -m pytest tests/test_intent_model.py -q
```

Expected: pass.

---

## Chunk 2: File Policy Node

### Task 2: Split deterministic file validation out of routing policy

**Files:**
- Create: `yuzik_workflow/file_policy.py`
- Create: `tests/test_file_policy_node.py`
- Modify: `yuzik_workflow/policy.py`

- [ ] **Step 1: Write failing tests**

Cover:

- valid text-only `TurnContext` passes through unchanged;
- unsupported inline file sets `ctx.route = "file_error"`;
- unsupported inline file returns an ADK `Event` with friendly message;
- `temp:turn_*` state is stored before routing;
- no LLM classifier is required for file errors.

- [ ] **Step 2: Run RED**

Run:

```powershell
python -m pytest tests/test_file_policy_node.py -q
```

Expected: fails because `file_policy_node` does not exist.

- [ ] **Step 3: Implement `file_policy_node`**

Move this responsibility out of `policy.py`:

- `evaluate_file_policy(content)`
- storing `temp:turn_current_text`
- storing `temp:turn_previous_text`
- storing `temp:turn_previous_summary`
- storing `temp:turn_previous_artifact_id`
- storing `temp:turn_language`

`file_policy_node(ctx, turn)` should:

- accept `TurnContext`;
- store turn fields in state;
- validate file parts;
- route `file_error` only when needed;
- return the original `TurnContext` or ADK `Event`.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
python -m pytest tests/test_file_policy_node.py tests/test_turn_context_node.py -q
```

Expected: pass.

---

## Chunk 3: Intent Classifier Agent

### Task 3: Add cheap structured classifier

**Files:**
- Create: `yuzik_workflow/intent_classifier.py`
- Create: `tests/test_intent_classifier_node.py`
- Modify: `config.py` only if a dedicated classifier model constant is needed.

- [ ] **Step 1: Write failing tests for classifier prompt/callback**

Test without making a real LLM call. Use a fake request object with `append_instructions()`.

Cover:

- callback includes `current_text`;
- callback includes `previous_text` and `previous_summary` when present;
- callback includes whether file parts exist;
- instruction says classifier returns only structured `TurnIntent`;
- instruction says it must not answer the user;
- prompt documents the allowed routes/actions.

- [ ] **Step 2: Run RED**

Run:

```powershell
python -m pytest tests/test_intent_classifier_node.py -q
```

Expected: fails because classifier module does not exist.

- [ ] **Step 3: Implement classifier**

Add `intent_classifier_agent = LlmAgent(...)` with:

- `name="intent_classifier_agent"`;
- cheap model, initially `config.ROUTER_AGENT_MODEL` unless a cheaper model constant already exists;
- `output_schema=TurnIntent`;
- no tools;
- callback that appends structured context from state.

Classifier instruction must include:

```text
You classify the latest user turn for the Yuzik workflow.
Return only the structured schema.
Do not answer the user.

Routes:
- default: normal text/tool answer by router_agent
- image: user wants an image generated
- translation: user wants text translated
- direct: workflow should answer directly without router_agent
- cancel: user cancels a pending generation/action

Actions:
- tts: user wants the final answer or referenced text synthesized as audio

Use needs_previous_context=true only when the latest turn needs previous_text or previous_summary.
```

- [ ] **Step 4: Run GREEN**

Run:

```powershell
python -m pytest tests/test_intent_classifier_node.py tests/test_intent_model.py -q
```

Expected: pass.

---

## Chunk 4: Intent Policy Node

### Task 4: Replace regex routing with deterministic intent application

**Files:**
- Modify: `yuzik_workflow/policy.py`
- Create: `tests/test_intent_policy_node.py`
- Modify: `tests/test_input_policy_node.py`

- [ ] **Step 1: Write failing route tests**

Cover these `TurnIntent` inputs:

- route `image` -> `ctx.route == "image"`;
- route `translation`, `target_language="en"` -> `ctx.route == "translate"` and translation state set;
- action `tts` -> `temp:tts_requested is True`;
- timezone `"Europe/Minsk"` -> `temp:minsk_time_enabled is True` and `temp:timezone == "Europe/Minsk"`;
- route `cancel` -> clears pending text action and routes cancel;
- confidence below threshold -> default route, but still preserves `actions` only if explicitly desired. Recommended: ignore low-confidence route/action and use default.

- [ ] **Step 2: Write regex guard tests**

Add guard assertions:

```python
import inspect
import yuzik_workflow.policy as policy


def test_policy_does_not_import_or_compile_regex():
    source = inspect.getsource(policy)

    assert "import re" not in source
    assert "re.compile" not in source
    assert "_PATTERN" not in source
```

- [ ] **Step 3: Run RED**

Run:

```powershell
python -m pytest tests/test_intent_policy_node.py tests/test_input_policy_node.py -q
```

Expected: fails because `policy.py` still regex-classifies text.

- [ ] **Step 4: Implement `intent_policy_node`**

`intent_policy_node(ctx, node_input)` should:

- call `coerce_turn_intent(node_input)`;
- store `temp:turn_intent_route`;
- store `temp:turn_intent_confidence`;
- if confidence is below threshold, use default route;
- set `temp:tts_requested = "tts" in intent.actions`;
- set `temp:minsk_time_enabled = intent.timezone == "Europe/Minsk"`;
- set `temp:timezone = intent.timezone`;
- set translation state when route is translation;
- set `ctx.route`.

No regex. No content text inspection except for passing through `temp:turn_current_text`.

- [ ] **Step 5: Run GREEN**

Run:

```powershell
python -m pytest tests/test_intent_policy_node.py tests/test_input_policy_node.py -q
```

Expected: pass.

---

## Chunk 5: Graph Wiring

### Task 5: Wire new graph sequence

**Files:**
- Modify: `yuzik_workflow/root.py`
- Modify: `tests/test_adk2_workflow_integration.py`

- [ ] **Step 1: Write failing graph tests**

Assert these edges exist:

```python
assert ("turn_context_node", "file_policy_node") in edge_names
assert ("file_policy_node", "intent_classifier_agent") in edge_names
assert ("intent_classifier_agent", "intent_policy_node") in edge_names
assert ("intent_policy_node", "image_prompt_agent") in edge_names
assert ("intent_policy_node", "translation_agent") in edge_names
```

Assert old direct edge is gone:

```python
assert ("turn_context_node", "input_policy_node") not in edge_names
```

- [ ] **Step 2: Run RED**

Run:

```powershell
python -m pytest tests/test_adk2_workflow_integration.py -q
```

Expected: fails because graph still uses `input_policy_node`.

- [ ] **Step 3: Update graph**

Target shape:

```python
turn_context = node(turn_context_node, name="turn_context_node")
file_policy = node(file_policy_node, name="file_policy_node")
intent_policy = node(intent_policy_node, name="intent_policy_node")

edges=[
    (
        START,
        turn_context,
        file_policy,
        {
            "file_error": fallback,
            DEFAULT_ROUTE: intent_classifier_agent,
        },
    ),
    (
        intent_classifier_agent,
        intent_policy,
        {
            "cancel": route_validation_cancel,
            "image": image_prompt_agent,
            "direct": direct_postprocess,
            "translate": translation_agent,
            DEFAULT_ROUTE: router_agent,
        },
    ),
    ...
]
```

Adjust exact edge syntax to match ADK `Workflow` route semantics used in current `root.py`.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
python -m pytest tests/test_adk2_workflow_integration.py -q
```

Expected: pass.

---

## Chunk 6: Router Agent Cleanup

### Task 6: Remove natural-language regex state mutation from router agent

**Files:**
- Modify: `router_agent/agent.py`
- Modify: `tests/test_adk2_workflow_integration.py`

- [ ] **Step 1: Write failing guard test**

Add:

```python
import inspect
import router_agent.agent as router_module


def test_router_agent_has_no_regex_intent_patterns():
    source = inspect.getsource(router_module)

    assert "TTS_REQUESTED_PATTERN" not in source
    assert "IMAGE_REQUESTED_PATTERN" not in source
    assert "TIME_RELATED_PATTERN" not in source
    assert "CREATION_CANCEL_PATTERN" not in source
    assert "re.compile" not in source
```

- [ ] **Step 2: Run RED**

Run:

```powershell
python -m pytest tests/test_adk2_workflow_integration.py::test_router_agent_has_no_regex_intent_patterns -q
```

Expected: fails because router still owns regex patterns.

- [ ] **Step 3: Simplify router callback**

Replace `enable_minsk_time_mode()` with a callback that only:

- appends `MINSK_TIME_INSTRUCTION` when `callback_context.state["temp:minsk_time_enabled"]` is true;
- appends previous context instruction from `temp:turn_previous_text`/`temp:turn_previous_summary`;
- does not mutate `temp:tts_requested`;
- does not mutate `temp:image_requested`;
- does not inspect latest user text with regex.

Rename it to `add_router_context()` if helpful, and update `router_agent.before_model_callback`.

- [ ] **Step 4: Run GREEN**

Run:

```powershell
python -m pytest tests/test_adk2_workflow_integration.py tests/test_intent_policy_node.py -q
```

Expected: pass.

---

## Chunk 7: Translation, Image, TTS Compatibility

### Task 7: Align downstream consumers with `TurnIntent`

**Files:**
- Modify: `yuzik_workflow/translation.py`
- Modify: `yuzik_workflow/image_workflow.py` only if tests show needed
- Modify: `services/adk_service.py` only if TTS fallback tests show needed
- Modify: `tests/test_adk_service_tts_fallback.py`
- Modify: `tests/test_image_prompt_workflow.py`
- Modify: `tests/test_adk2_workflow_integration.py`

- [ ] **Step 1: Run existing focused tests**

Run:

```powershell
python -m pytest tests/test_image_prompt_workflow.py tests/test_adk_service_tts_fallback.py tests/test_text_to_speech_tool.py tests/test_adk2_workflow_integration.py -q
```

Expected: some tests may fail because `temp:tts_requested`, `temp:minsk_time_enabled`, and translation state now come from `TurnIntent`.

- [ ] **Step 2: Fix only broken state assumptions**

Keep these contracts:

- image route still skips TTS when `temp:tts_requested` is true;
- translation route still receives `temp:translation_target_language`;
- translation callback still gets `current_text`, `previous_text`, and `previous_summary`;
- service TTS fallback still synthesizes final reply unless explicit literal text was provided.

- [ ] **Step 3: Run focused tests**

Run:

```powershell
python -m pytest tests/test_image_prompt_workflow.py tests/test_adk_service_tts_fallback.py tests/test_text_to_speech_tool.py tests/test_adk2_workflow_integration.py -q
```

Expected: pass.

---

## Chunk 8: No-Regex Verification

### Task 8: Add repository-level natural-language routing guards

**Files:**
- Create: `tests/test_no_regex_intent_routing.py`

- [ ] **Step 1: Write guard tests**

Guard only workflow intent-routing modules, not unrelated utilities. The test should scan:

- `yuzik_workflow/policy.py`
- `yuzik_workflow/intent.py`
- `yuzik_workflow/intent_classifier.py`
- `yuzik_workflow/file_policy.py`
- `router_agent/agent.py`

Assert:

- no `re.compile`;
- no `_PATTERN`;
- no old symbol names:
  - `TTS_REQUESTED_PATTERN`
  - `IMAGE_REQUESTED_PATTERN`
  - `TIME_RELATED_PATTERN`
  - `CREATION_CANCEL_PATTERN`
  - `TRANSLATION_REQUEST_PATTERN`
  - `ENGLISH_TARGET_PATTERN`

Do not scan docs or tests, because they may mention old names as negative assertions.

- [ ] **Step 2: Run guard**

Run:

```powershell
python -m pytest tests/test_no_regex_intent_routing.py -q
```

Expected: pass after chunks 4 and 6.

---

## Chunk 9: Backend Verification

### Task 9: Run backend test suite

**Files:**
- No production changes expected

- [ ] **Step 1: Run focused intent tests**

Run:

```powershell
python -m pytest tests/test_intent_model.py tests/test_file_policy_node.py tests/test_intent_classifier_node.py tests/test_intent_policy_node.py tests/test_no_regex_intent_routing.py -q
```

Expected: pass.

- [ ] **Step 2: Run existing workflow tests**

Run:

```powershell
python -m pytest tests/test_turn_context_node.py tests/test_input_policy_node.py tests/test_postprocess_node.py tests/test_image_prompt_workflow.py tests/test_adk2_workflow_integration.py tests/test_adk_service_tts_fallback.py -q
```

Expected: pass.

- [ ] **Step 3: Run full backend tests**

Run:

```powershell
python -m pytest tests -q
```

Expected: pass.

---

## Chunk 10: E2E Verification

### Task 10: Run Playwright real-backend context flow

**Files:**
- Modify: `frontend/tests/e2e/adk2-chat-real-backend.spec.js` only if assertions depend on old regex assumptions.

- [ ] **Step 1: Run e2e**

Run:

```powershell
cd D:\CodexPRJ\Yuzik\frontend
npm run test:e2e
```

Expected: pass.

- [ ] **Step 2: Inspect dialogue artifact**

Open latest:

```powershell
Get-ChildItem -Path .\frontend\test-results -Recurse -Filter adk2-chat-dialogue.md |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1 -ExpandProperty FullName
```

Required evidence:

- weather turn returns a weather answer;
- `Агуч яго` returns an audio artifact;
- `Прыдумай і агуч казку` returns story text and audio;
- `Зрабі малюнак па ёй` returns an image artifact whose caption/prompt reflects the previous story;
- Verbum flow still reaches router/tool behavior.

---

## Done Criteria

- Graph-based workflow is preserved.
- `turn_context_node` remains the first user-input context node.
- File validation is deterministic and happens before classifier.
- One structured LLM classifier decides natural-language route/action intent.
- `policy.py` no longer imports `re`, calls `re.compile`, or owns natural-language pattern constants.
- `router_agent/agent.py` no longer owns route/action regex constants or mutates route/action state from user text.
- Previous assistant context remains structured state data, not prompt rewriting.
- Low-confidence or invalid classifier output falls back to `default`.
- Backend tests pass.
- Playwright e2e passes and dialogue artifact proves follow-up context behavior.

## Rollback

If the new classifier breaks routing broadly:

```powershell
git restore yuzik_workflow/root.py yuzik_workflow/policy.py router_agent/agent.py
git restore --staged yuzik_workflow/intent.py yuzik_workflow/file_policy.py yuzik_workflow/intent_classifier.py
```

If only classifier prompt/schema breaks:

```powershell
git restore yuzik_workflow/intent_classifier.py tests/test_intent_classifier_node.py
```

Do not reintroduce regex routing as the long-term fix. Use rollback only as a temporary operational fallback.
