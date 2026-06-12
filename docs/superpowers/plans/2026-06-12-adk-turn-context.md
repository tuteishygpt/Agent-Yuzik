# ADK Turn Context Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make follow-up requests such as "aguch yae", "zrabí maliunak pa im", and "pierakladzi aposhni adkaz" resolve to the previous assistant output without maintaining object noun lists such as story, joke, forecast, or report.

**Architecture:** Keep the current ADK 2 graph-based workflow. Add one deterministic `turn_context_node` before `input_policy_node` that builds a structured `TurnContext` from the current user message and persisted ADK session state. Pass previous assistant context as data, not by regex-specific prompt rewriting, and let the relevant LLM node decide whether the current turn actually refers to it.

**Tech Stack:** Python 3.13, `google-adk>=2.0,<3.0`, ADK `Workflow`, `LlmAgent`, function nodes, `DatabaseSessionService`, `google-genai`, pytest, Playwright e2e as optional final verification.

---

## Current Architecture

The production chat path is a graph-based ADK workflow created in `yuzik_workflow/root.py`.

Current graph:

```text
START
  -> input_policy_node
      file_error -> error_fallback_node
      cancel     -> route_validation_cancel_node -> postprocess_cancel_node
      direct     -> direct_postprocess_node
      translate  -> translation_agent -> translation_postprocess_node
      image      -> image_prompt_agent -> execute_image_workflow -> image_post_action_node -> image_postprocess_node
      default    -> router_agent -> route_validation_node -> post_action_node -> postprocess_node
```

The graph type is graph-based workflow, not dynamic workflow and not collaborative workflow:

- It uses `Workflow(name=..., edges=[...])` and static route mapping.
- It does not use dynamic `ctx.run_node(...)` loops or runtime graph construction.
- It does not use a coordinator agent delegating to task-mode subagents as a collaborative workflow.

The current context handling is concentrated in `yuzik_workflow/policy.py`:

- `PREVIOUS_CONTEXT_REFERENCE_PATTERN` detects a limited set of pronouns and concrete nouns.
- `STORY_REFERENCE_PATTERN` special-cases story context for image requests.
- `input_policy_node` rewrites the user `Content` by appending previous context text.
- `postprocess_node` stores `user:last_assistant_text` and sometimes `user:last_story_text`.

This works for known words but does not scale to arbitrary content types like jokes, reports, poems, explanations, dictionary results, weather, or generated text.

## ADK Documentation Alignment

This plan keeps the project within ADK 2 graph-based workflow guidance:

- ADK graph workflows define explicit nodes and edges for deterministic routing and execution control: https://adk.dev/graphs/
- Graph routes use nodes that emit route values and pass data between nodes: https://adk.dev/graphs/routes/
- Workflow data should be passed through node input/output and small state values, not hidden prompt hacks: https://adk.dev/graphs/data-handling/
- Session state is appropriate for small persisted values; large outputs should use artifacts or a database reference: https://adk.dev/sessions/state/

## Target Architecture

New graph:

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

`turn_context_node` becomes the single owner of turn-level context packaging. It must not decide that the previous answer is a story, joke, forecast, or any other object type.

Target data model:

```python
from dataclasses import dataclass

from google.genai import types


@dataclass(frozen=True)
class TurnContext:
    current_content: types.Content
    current_text: str | None
    previous_text: str | None
    previous_summary: str | None
    previous_artifact_id: str | None
    language: str
```

Rules:

- `current_text` is extracted from the latest user content.
- `previous_text` comes from `user:last_assistant_text` if it is small enough.
- `previous_summary` comes from `user:last_assistant_summary` once summaries exist.
- `previous_artifact_id` points to stored large content when full text is too large for state.
- No object noun list is used.
- Pronoun/reference interpretation is handled by the receiving LLM node instruction, not by deterministic regex.

## File Structure

Create:

- `yuzik_workflow/context.py` - `TurnContext`, text extraction, previous-context loading, and context-to-content helpers.
- `tests/test_turn_context_node.py` - focused unit tests for context construction and no noun-list behavior.

Modify:

- `yuzik_workflow/root.py` - insert `turn_context_node` before `input_policy_node`.
- `yuzik_workflow/policy.py` - consume `TurnContext`; keep route/action detection only; remove object noun context regexes.
- `yuzik_workflow/image_workflow.py` - consume `TurnContext` context fields instead of `temp:image_context_text` prompt rewriting.
- `yuzik_workflow/translation.py` - use `TurnContext.current_text` for pending translation source text.
- `yuzik_workflow/postprocess.py` - store generic previous assistant text/summary, not story-only state.
- `router_agent/agent.py` - add concise instruction that `previous_text` is available when the current request refers to prior output.
- `tests/test_input_policy_node.py` - update policy expectations from rewritten `Content` to structured `TurnContext`.
- `tests/test_postprocess_node.py` - cover generic previous-output persistence.
- `frontend/tests/e2e/adk2-chat-real-backend.spec.js` - optional final e2e assertion updates after backend behavior is stable.

Do not modify unless needed:

- Supabase migrations. `ADKSessionStore` stores active session mapping, while ADK runtime state uses `DatabaseSessionService`.
- Voice streaming path. It currently runs `router_agent` directly because ADK graph workflows are not live-stream compatible.

## Chunk 1: Context Model

### Task 1: Add `TurnContext`

**Files:**
- Create: `yuzik_workflow/context.py`
- Test: `tests/test_turn_context_node.py`

- [ ] **Step 1: Write failing tests for context construction**

Cover:

- Latest user `Content` text becomes `current_text`.
- `user:last_assistant_text` becomes `previous_text`.
- Missing previous state yields `previous_text is None`.
- File parts are preserved in `current_content`.
- The implementation has no concrete content noun allowlist.

Run:

```powershell
python -m pytest tests/test_turn_context_node.py -q
```

Expected: fails because `yuzik_workflow.context` does not exist.

- [ ] **Step 2: Implement `TurnContext` and helpers**

Add:

```python
MAX_INLINE_PREVIOUS_TEXT_CHARS = 6000


def text_from_content(content: types.Content | None) -> str | None:
    ...


def previous_text_from_state(state: dict[str, object]) -> str | None:
    ...


async def turn_context_node(ctx, node_input):
    ...
```

`turn_context_node` should return `TurnContext`, not rewritten `types.Content`.

- [ ] **Step 3: Run focused tests**

Run:

```powershell
python -m pytest tests/test_turn_context_node.py -q
```

Expected: pass.

## Chunk 2: Workflow Wiring

### Task 2: Insert `turn_context_node`

**Files:**
- Modify: `yuzik_workflow/root.py`
- Modify: `yuzik_workflow/policy.py`
- Test: `tests/test_input_policy_node.py`

- [ ] **Step 1: Wire the graph**

Change the first edge from:

```python
(START, input_policy, {...})
```

to:

```python
(START, turn_context, input_policy, {...})
```

- [ ] **Step 2: Make `input_policy_node` accept `TurnContext`**

`input_policy_node` should:

- read `turn.current_text`;
- preserve `turn.current_content` for downstream nodes;
- set action/routing flags in `ctx.state`;
- stop appending "previous context" text into the user message;
- return either `turn`, `turn.current_content`, or direct response content depending on the route contract chosen during implementation.

- [ ] **Step 3: Remove noun-specific context checks**

Remove or deprecate:

- `STORY_REFERENCE_PATTERN`
- `PREVIOUS_CONTEXT_REFERENCE_PATTERN`
- `image_context_for_request`
- `previous_context_for_request`
- `image_request_with_context`
- `request_with_previous_context`
- `content_with_replaced_text` if no longer needed

Keep action regexes for TTS, image, translation, cancel, time, and file validation. Those are routing/action detectors, not object referent lists.

- [ ] **Step 4: Run policy tests**

Run:

```powershell
python -m pytest tests/test_input_policy_node.py tests/test_turn_context_node.py -q
```

Expected: pass.

## Chunk 3: LLM Context Consumption

### Task 3: Teach agents to use structured previous context

**Files:**
- Modify: `router_agent/agent.py`
- Modify: `yuzik_workflow/image_workflow.py`
- Modify: `yuzik_workflow/translation.py`
- Test: existing focused tests plus new cases where useful

- [ ] **Step 1: Add router instruction**

Add a short instruction to `router_agent`:

```text
If the workflow provides previous_text or previous_summary, use it only when the
latest user request clearly refers to prior assistant output, for example with
"it", "this", "that", "above", "previous", "яе", "яго", "гэта", "апошні".
If the latest request is self-contained, ignore previous_text.
```

This list is pronoun/reference language, not object noun routing.

- [ ] **Step 2: Pass context to image prompt generation**

`image_prompt_agent` should receive a structured prompt containing:

- current image request;
- previous text/summary as optional context;
- instruction to use previous context only if the request refers to it.

Do not special-case stories.

- [ ] **Step 3: Pass context to translation**

For pending translation, translate `TurnContext.current_text`.

For follow-up requests such as "translate the previous answer", use `previous_text` when the request semantically refers to previous output.

- [ ] **Step 4: Run focused backend tests**

Run:

```powershell
python -m pytest tests/test_input_policy_node.py tests/test_postprocess_node.py tests/test_adk_service_tts_fallback.py -q
```

Expected: pass.

## Chunk 4: Generic Previous Output Persistence

### Task 4: Store generic previous assistant output

**Files:**
- Modify: `yuzik_workflow/postprocess.py`
- Test: `tests/test_postprocess_node.py`

- [ ] **Step 1: Keep `user:last_assistant_text` generic**

Continue storing any sufficiently useful assistant text:

```python
ctx.state["user:last_assistant_text"] = text
```

- [ ] **Step 2: Replace story-only state with optional summary**

Remove reliance on:

```python
ctx.state["user:last_story_text"]
```

Add:

```python
ctx.state["user:last_assistant_summary"] = summarize_for_context(text)
```

For the first implementation, `summarize_for_context` can be deterministic truncation. Add LLM summarization later only if state size becomes a real problem.

- [ ] **Step 3: Handle large text safely**

If text is larger than `MAX_INLINE_PREVIOUS_TEXT_CHARS`:

- store a truncated context summary in state;
- keep full text out of ADK state;
- optionally add artifact/database reference in a later task.

- [ ] **Step 4: Run postprocess tests**

Run:

```powershell
python -m pytest tests/test_postprocess_node.py -q
```

Expected: pass.

## Chunk 5: Service And Channel Consistency

### Task 5: Keep service-level TTS behavior compatible

**Files:**
- Modify: `services/adk_service.py` only if needed
- Test: `tests/test_adk_service_tts_fallback.py`

- [ ] **Step 1: Verify `aguch yae` uses generated/contextual reply**

The service-level `_maybe_run_service_tts_post_action` should synthesize the final reply unless the user explicitly provides literal text after `text:` or a quoted/colon target.

- [ ] **Step 2: Avoid noun parsing in service TTS**

Do not make `_extract_tts_target_text` recognize object words such as joke/story/report. It should only detect explicit literal text.

- [ ] **Step 3: Run TTS fallback tests**

Run:

```powershell
python -m pytest tests/test_adk_service_tts_fallback.py tests/test_text_to_speech_tool.py -q
```

Expected: pass.

## Chunk 6: Verification

### Task 6: Backend verification

**Files:**
- No production changes expected

- [ ] **Step 1: Run focused tests**

Run:

```powershell
python -m pytest tests/test_turn_context_node.py tests/test_input_policy_node.py tests/test_postprocess_node.py tests/test_adk_service_tts_fallback.py -q
```

Expected: pass.

- [ ] **Step 2: Run full backend tests**

Run:

```powershell
python -m pytest tests -q
```

Expected: pass.

### Task 7: End-to-end context verification

**Files:**
- Modify e2e test only if assertions still depend on brittle object words

- [ ] **Step 1: Run Playwright e2e**

Run:

```powershell
cd D:\CodexPRJ\Yuzik\frontend
npm run test:e2e
```

Expected: pass.

- [ ] **Step 2: Manually inspect generated dialogue**

Check `frontend/test-results/**/adk2-chat-dialogue.md`.

Required scenarios:

- "Prydumaj kazku" -> story text.
- "Aguch yae" -> audio for the story.
- "Prydumaj aniekdot" -> joke text.
- "Aguch yaho" -> audio for the joke.
- "Raskazhi pra Minsk" -> informational answer.
- "Zrabi maliunak pa hetym" -> image prompt uses the Minsk answer, not a hardcoded noun.

## Done Criteria

- The production chat graph contains `turn_context_node` before `input_policy_node`.
- Follow-up context is represented by `TurnContext`, not by rewriting user text with regex-matched object nouns.
- No object noun list is required for story, joke, report, forecast, poem, or explanation.
- `input_policy_node` only detects actions/routes: TTS, image, translation, cancel, time, file policy.
- `postprocess_node` stores generic previous assistant context.
- Image and translation routes can use previous output without story-specific state.
- TTS follow-ups synthesize the intended previous/generated text.
- Full backend tests pass.
- The Playwright dialogue artifact proves context works for at least two different content types.

## Rollback

If the new context node breaks routing:

```powershell
git restore yuzik_workflow/root.py yuzik_workflow/policy.py yuzik_workflow/image_workflow.py yuzik_workflow/translation.py yuzik_workflow/postprocess.py router_agent/agent.py
```

If only image context breaks:

```powershell
git restore yuzik_workflow/image_workflow.py
```

If only generic persistence breaks:

```powershell
git restore yuzik_workflow/postprocess.py
```

Do not reintroduce object noun lists as the rollback path. Restore the previous implementation only as a temporary operational fallback.
