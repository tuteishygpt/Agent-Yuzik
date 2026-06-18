# Workflow V2 Context Routing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first backend Workflow V2 slice: structured context packing, structured routing plans, deterministic route execution, post-action diagnostics, and deterministic memory updates without changing public chat clients.

**Architecture:** Keep the old workflow route agents available while adding a new `ContextPack -> RoutingPlan -> RouteExecutor -> PostActions -> MemoryUpdate` path. The executor maps new plans onto existing route nodes where that is safest, and falls back to chat for invalid or low-confidence plans.

**Tech Stack:** Python, Google ADK workflow nodes and `LlmAgent`, `google.genai.types`, pytest.

---

## Chunk 1: Context Pack

### Task 1: ContextPack Types And Builder

**Files:**
- Create: `yuzik_workflow/context_pack.py`
- Test: `tests/test_context_pack.py`

- [ ] **Step 1: Write failing tests** for current/previous text, recent messages, pending action, artifact refs, and size limits.
- [ ] **Step 2: Run** `python -m pytest tests/test_context_pack.py -v` and verify missing module failure.
- [ ] **Step 3: Implement** dataclasses plus `build_context_pack()` and `conversation_context_node()`.
- [ ] **Step 4: Run** `python -m pytest tests/test_context_pack.py -v` and verify pass.

## Chunk 2: Routing Plan

### Task 2: RoutingPlan Schema And Planner Prompt

**Files:**
- Create: `yuzik_workflow/routing_plan.py`
- Create: `yuzik_workflow/routing_planner.py`
- Test: `tests/test_routing_plan.py`
- Test: `tests/test_routing_planner_prompt.py`

- [ ] **Step 1: Write failing tests** for plan coercion, invalid fallback, context refs, post-actions, and prompt payload.
- [ ] **Step 2: Run focused tests** and verify failure.
- [ ] **Step 3: Implement** schema/coercion and ADK planner agent callback.
- [ ] **Step 4: Run focused tests** and verify pass.

## Chunk 3: Route Executor

### Task 3: Deterministic Executor

**Files:**
- Create: `yuzik_workflow/route_executor.py`
- Modify: `yuzik_workflow/root.py`
- Test: `tests/test_route_executor.py`

- [ ] **Step 1: Write failing tests** for chat fallback, dictionary missing/supplied, translate, image, direct, cancel, low confidence, and diagnostics.
- [ ] **Step 2: Run focused tests** and verify failure.
- [ ] **Step 3: Implement** executor that maps plans to existing route node state and `ctx.route`.
- [ ] **Step 4: Wire** workflow nodes while keeping existing route implementations.
- [ ] **Step 5: Run focused tests** and verify pass.

## Chunk 4: Memory And Post Actions

### Task 4: Deterministic Memory Update

**Files:**
- Create: `yuzik_workflow/memory_update.py`
- Modify: `yuzik_workflow/post_actions.py`
- Modify: `yuzik_workflow/postprocess.py`
- Test: `tests/test_memory_update.py`
- Test: `tests/test_post_actions.py`

- [ ] **Step 1: Write failing tests** for rolling summary, last route/tool summary, artifact refs, and TTS diagnostics.
- [ ] **Step 2: Run focused tests** and verify failure.
- [ ] **Step 3: Implement** deterministic state updates and diagnostics.
- [ ] **Step 4: Run focused tests** and verify pass.

## Chunk 5: Verification

### Task 5: Backend Verification

**Files:**
- Existing backend tests.

- [ ] **Step 1: Run** focused Workflow V2 tests.
- [ ] **Step 2: Run** existing workflow tests touched by the migration.
- [ ] **Step 3: Report** full backend/channel verification gaps if any remain.
