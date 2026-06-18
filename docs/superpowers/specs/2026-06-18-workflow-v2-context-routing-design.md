# Workflow V2 Context And Routing Migration Design

## Goal

Migrate Yuzik's chat workflow from a mostly last-turn routing model to a
context-aware, plan-driven architecture that improves follow-up understanding,
keeps tool routing predictable, and makes new tools or workflow nodes easier to
add.

The target architecture should improve all of these cases:

- Follow-up requests such as "read it aloud", "translate the previous answer",
  "continue", and "draw an image based on that".
- Multi-turn context where the useful reference is not only the immediately
  previous assistant answer.
- Tool routing for dictionary, weather, search, image, translation, TTS, and
  future tools.
- Debuggability: logs should show what context was used and why a route was
  selected.

This migration is backend-first. Web, mobile, Telegram, and voice clients should
keep their existing public contracts unless a later implementation plan proves a
client change is required.

## Current Architecture

The current non-streaming chat path is:

```text
FastAPI /api/chat
  -> ChatService
  -> ADKService.run_agent()
  -> yuzik_workflow
      -> turn_context_node
      -> file_policy_node
      -> intent_classifier_agent
      -> intent_policy_node
      -> route-specific path
      -> post_action_node
      -> postprocess_node
```

The existing `TurnContext` already captures the latest user content and some
previous assistant state. This is useful but too narrow for "whole
conversation" understanding:

- It primarily carries the current turn plus the previous assistant text or
  summary.
- The classifier decides the route but does not produce a complete execution
  plan.
- Some routing behavior is split across workflow nodes, router callbacks, agent
  prompts, service-level fallback behavior, and post-processing.
- New tools usually require touching prompts and routing code in several
  locations.

## Target Architecture

Workflow V2 introduces a stable contract:

```text
ContextPack -> RoutingPlan -> RouteExecutor -> PostActions -> MemoryUpdate
```

Proposed graph:

```text
START
  -> turn_context_node
  -> conversation_context_node
  -> routing_planner_agent
  -> route_executor_node
      chat        -> router_agent
      search      -> search route
      weather     -> weather route
      dictionary  -> dictionary route
      image       -> image_prompt_agent -> image generator
      translate   -> translation_agent
      direct      -> direct response / clarification
      cancel      -> cancel response
  -> post_action_node
  -> memory_update_node
  -> postprocess_node
```

### ContextPack

`conversation_context_node` builds a compact, structured package for the current
turn. It should include only information that is useful for routing and answer
generation.

Initial fields:

```python
@dataclass(frozen=True)
class ContextPack:
    current_content: types.Content
    current_text: str | None
    language: str
    recent_messages: list[ConversationMessage]
    rolling_summary: str | None
    previous_assistant_text: str | None
    previous_assistant_summary: str | None
    previous_artifact_id: str | None
    recent_artifacts: list[ArtifactRef]
    pending_action: PendingAction | None
    last_route: str | None
    last_tool_result_summary: str | None
```

Data sources:

- ADK session state for current lightweight state.
- `ConversationStore` and `ChatMessageStore` for recent conversation messages.
- `ArtifactStore` for recent assistant artifacts.
- Existing pending-action state for dictionary, translation, image, and TTS
  follow-ups.

The node must enforce size limits. It should prefer:

1. The latest user turn.
2. The latest assistant answer or summary.
3. A small recent-message window.
4. A rolling summary.
5. Artifact references, not raw artifact bytes.

### RoutingPlan

`routing_planner_agent` replaces the current intent classifier as the first
model-based decision point. It must not answer the user. It returns a structured
plan.

Draft schema:

```python
class RoutingPlan(BaseModel):
    route: Literal[
        "chat",
        "search",
        "weather",
        "dictionary",
        "image",
        "translate",
        "direct",
        "cancel",
    ]
    needs_previous_context: bool = False
    target_text_ref: Literal[
        "current_text",
        "previous_assistant_text",
        "rolling_summary",
        "artifact",
        "none",
    ] = "current_text"
    artifact_ref: str | None = None
    tools: list[str] = []
    post_actions: list[Literal["tts"]] = []
    pending_action_update: dict | None = None
    answer_style: Literal["normal", "brief", "tool_result"] = "normal"
    confidence: float
    rationale: str
```

The `rationale` is for logs and tests, not for the user. It should be short and
non-sensitive.

### RouteExecutor

`route_executor_node` validates and executes `RoutingPlan`.

Responsibilities:

- Reject impossible plans and fall back to `chat` or `direct` clarification.
- Keep deterministic routes deterministic when possible.
- Avoid calling `router_agent` for routes that already have a precise
  implementation.
- Pass the selected context reference to the chosen route.
- Record diagnostics: selected route, tools, confidence, context references,
  and fallback reason.

Initial route behavior:

- `chat`: call `router_agent` with ContextPack instructions.
- `search`: call the search path only when current information is required.
- `weather`: call `weather_tool` directly when weather intent is clear.
- `dictionary`: call `lookup_dictionary` directly when the word is known; ask
  for the word when missing.
- `image`: call `image_prompt_agent`, then `generate_image`.
- `translate`: call `translation_agent`.
- `direct`: return a direct clarification, cancellation, or pending-action
  prompt.
- `cancel`: clear pending action and skip post-actions.

### PostActions

`post_action_node` remains the place for TTS. The planner may request TTS, but
the route executor and post-action node decide whether it is valid.

Rules:

- Plain text answers do not trigger TTS unless requested.
- Image generation skips TTS by default and records diagnostics.
- TTS uses the selected answer text or explicit target text.
- TTS remains a deterministic post-action, not a free router tool.

### MemoryUpdate

Phase one should not add an LLM memory extractor on every turn.

Initial behavior:

- Deterministically store the latest assistant text and summary, as today.
- Maintain a rolling summary with truncation and clear size limits.
- Store latest route and tool result summary in ADK state.
- Store artifact references, not bytes.

Later optional behavior:

- Add an LLM memory extractor only for turns that are long, user-preference
  bearing, or otherwise worth persisting.
- Persist extracted user preferences/facts in Supabase after a separate privacy
  and schema review.

## Model Call Budget

Workflow V2 should not increase the common-case number of model calls.

### Plain Chat

Current typical budget:

```text
intent_classifier_agent: 1
router_agent: 1
total: 2 LLM calls
```

Workflow V2:

```text
routing_planner_agent: 1
router_agent: 1
total: 2 LLM calls
```

Token usage may increase slightly because ContextPack is richer. Size limits are
therefore required.

### Weather, Dictionary, Time

Current typical budget:

```text
classifier: 1
router decision: 1
router final after tool: 0-1
total: 2-3 LLM calls
```

Workflow V2 target:

```text
planner: 1
deterministic tool route: 0
optional final formatting: 0-1
total: 1-2 LLM calls
```

The first implementation should prefer tool routes that return ready-to-display
Belarusian text, avoiding an extra final-formatting LLM call.

### Search

Search remains more expensive because synthesis is usually needed.

Workflow V2 target:

```text
planner: 1
search path: 1-2
final synthesis: 0-1
total: 2-4 LLM calls
```

The target is to reduce duplicate router/sub-agent synthesis where possible.

### Image

Current typical budget:

```text
classifier: 1
image_prompt_agent: 1
image model: 1
total: 3 model calls
```

Workflow V2:

```text
planner: 1
image_prompt_agent: 1
image model: 1
total: 3 model calls
```

### Translation

Current typical budget:

```text
classifier: 1
translation_agent: 1
total: 2 LLM calls
```

Workflow V2:

```text
planner: 1
translation_agent: 1
total: 2 LLM calls
```

### Memory

Phase one:

```text
memory_update_node: 0 LLM calls
```

Later optional memory extraction:

```text
memory_extractor_agent: +1 LLM call only on selected turns
```

## Migration Plan

### Phase 1: Types And ContextPack

Create:

- `yuzik_workflow/context_pack.py`
- `tests/test_context_pack.py`

Modify:

- `services/chat_service.py` only if dependency injection is needed.
- `api/deps.py` only if shared stores need to be passed into workflow context.

Deliverables:

- ContextPack dataclasses.
- Recent-message loading with strict limits.
- Artifact references with no raw artifact bytes.
- Unit tests for context size, previous context, recent messages, and pending
  actions.

### Phase 2: RoutingPlan

Create:

- `yuzik_workflow/routing_plan.py`
- `yuzik_workflow/routing_planner.py`
- `tests/test_routing_plan.py`
- `tests/test_routing_planner_prompt.py`

Modify:

- `yuzik_workflow/root.py`
- Keep `intent_classifier_agent` temporarily available behind a feature flag or
  fallback if practical.

Deliverables:

- Structured `RoutingPlan` schema.
- Planner prompt focused on classification, context references, and tools.
- Confidence and fallback policy.
- Tests for chat, follow-up TTS, previous-answer image, weather, dictionary,
  search, translation, and cancel plans.

### Phase 3: RouteExecutor

Create:

- `yuzik_workflow/route_executor.py`
- `tests/test_route_executor.py`

Modify:

- `yuzik_workflow/root.py`
- `yuzik_workflow/dictionary.py`
- `yuzik_workflow/image_workflow.py`
- `yuzik_workflow/translation.py`
- `router_agent/agent.py`

Deliverables:

- Deterministic executor with route-specific branches.
- Direct weather/dictionary/time routes.
- Router fallback for low-confidence or unsupported plans.
- Diagnostics in state.
- Reduced duplicated policy in `router_agent`.

### Phase 4: PostActions And MemoryUpdate

Create or modify:

- `yuzik_workflow/memory_update.py`
- `yuzik_workflow/post_actions.py`
- `yuzik_workflow/postprocess.py`
- `tests/test_memory_update.py`
- `tests/test_post_actions.py`

Deliverables:

- Deterministic rolling summary.
- Last route/tool result state.
- Safe artifact references.
- TTS remains post-action only.

### Phase 5: Channel Verification

Run and document:

- Focused backend tests.
- Full backend tests.
- Web chat smoke tests.
- Telegram smoke tests.
- Voice compatibility decision.

Voice note:

- `/api/voice` currently uses `handle_simple_voice` when
  `SIMPLE_VOICE_AGENT=True`, bypassing the non-streaming workflow.
- Workflow V2 should first target `/api/chat` and Telegram.
- Voice migration should be a separate follow-up unless streaming workflow
  compatibility is proven.

## Adding New Tools Or Nodes

Workflow V2 should make a new tool addition follow one path:

1. Add route name or tool identifier to `RoutingPlan`.
2. Add planner examples and tests.
3. Add executor branch.
4. Add route-specific node/tool wrapper.
5. Add focused tests.
6. Add one integration test through `ADKService.run_agent()`.

Avoid adding new tools only by expanding `router_agent` prompt text.

## Error Handling

- Invalid planner output falls back to `chat` with diagnostics.
- Low planner confidence falls back to `chat` unless the plan is a safe direct
  clarification.
- Missing required route data returns a direct clarification, for example asking
  which dictionary word to search.
- Tool failures return existing friendly fallback text and record diagnostics.
- Post-action failures should not erase the primary text answer.

## Observability

Every turn should log or expose diagnostics for:

- context pack size and selected context references;
- planner route, confidence, and short rationale;
- executor branch;
- tools called;
- post-actions requested and executed;
- fallback reason if any.

Diagnostics should be testable but should not leak sensitive raw conversation
content into logs.

## Test Strategy

Focused tests:

- `ContextPack` construction and size limits.
- Planner schema and prompt examples.
- Planner output coercion and fallback.
- Route executor branch selection.
- Follow-up references to previous text, summary, and artifacts.
- Tool routes: dictionary, weather, search, image, translation.
- TTS post-action and cancel behavior.
- Memory update behavior.

Integration tests:

- `ADKService.run_agent()` plain chat.
- Follow-up "read it aloud" after a generated answer.
- Follow-up image from previous answer.
- Dictionary word missing, then supplied in next turn.
- Weather direct route.
- Search route with current-information request.

Manual smoke tests:

- Web `/api/chat`.
- Telegram text and media paths.
- Voice documented as unchanged or separately migrated.

## Success Criteria

- Common plain chat remains at two LLM calls.
- Weather/dictionary/time routes do not require router roundtrips.
- Follow-up context works across at least three content types: generated story,
  factual answer, and tool result.
- New route additions no longer require changing `router_agent` as the primary
  routing mechanism.
- Full backend test suite passes.
- No public API contract changes for web/mobile clients.

## Risks

- Planner mistakes can route a turn incorrectly. Mitigation: confidence,
  fallback-to-chat, and visible diagnostics.
- ContextPack can become too large. Mitigation: strict field limits and
  summaries.
- The migration can duplicate old and new routing during transition.
  Mitigation: feature flags or staged removal with tests.
- Search route may still need multiple LLM calls. Mitigation: measure and avoid
  duplicate synthesis where possible.
- Long-term memory can create privacy and schema concerns. Mitigation: defer LLM
  memory extraction to a separate design.

## Rollback

If planner routing is unstable:

```powershell
git restore yuzik_workflow/root.py yuzik_workflow/routing_planner.py yuzik_workflow/route_executor.py
```

If only ContextPack loading causes problems:

```powershell
git restore yuzik_workflow/context_pack.py
```

If post-action or memory update behavior breaks:

```powershell
git restore yuzik_workflow/post_actions.py yuzik_workflow/memory_update.py yuzik_workflow/postprocess.py
```

Keep the existing `intent_classifier_agent` path available until Workflow V2 has
focused and integration test coverage.
