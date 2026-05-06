# ADK Minsk Datetime Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Minsk datetime ADK tool and make the router agent persist a Minsk-time-aware mode after the first time-related user request.

**Architecture:** Introduce a local `FunctionTool` backed by Python timezone utilities, store the Minsk-time mode in ADK user state, and use a `before_model_callback` to add dynamic instructions for future time-sensitive turns. Tighten the existing tool guard so only repeated TTS calls are blocked.

**Tech Stack:** Python, Google ADK, pytest, standard-library `zoneinfo`

---

## Chunk 1: Tool behavior and callback logic

### Task 1: Add failing tests for Minsk datetime behavior

**Files:**
- Create: `tests/test_minsk_datetime_tool.py`
- Modify: none
- Test: `tests/test_minsk_datetime_tool.py`

- [ ] **Step 1: Write the failing tests**

```python
async def test_get_minsk_datetime_sets_state_and_returns_minsk_timezone(): ...
def test_before_model_callback_enables_minsk_mode_for_time_queries(): ...
def test_guard_one_call_only_blocks_second_tts_call(): ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_minsk_datetime_tool.py -v`
Expected: FAIL because the Minsk datetime module and callback behavior do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
async def get_minsk_datetime(...):
    now = datetime.now(ZoneInfo("Europe/Minsk"))
    tool_context.state["user:timezone"] = "Europe/Minsk"
    tool_context.state["user:minsk_time_enabled"] = True
    return {...}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_minsk_datetime_tool.py -v`
Expected: PASS

## Chunk 2: Router wiring and focused verification

### Task 2: Wire the tool into the router agent

**Files:**
- Modify: `router_agent/agent.py`
- Modify: `tests/test_gemini_model_aliases.py`
- Test: `tests/test_minsk_datetime_tool.py`
- Test: `tests/test_gemini_model_aliases.py`

- [ ] **Step 1: Write the failing regression assertion**

```python
def test_router_agent_uses_minsk_datetime_tool():
    ...
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_gemini_model_aliases.py::test_router_agent_uses_minsk_datetime_tool -v`
Expected: FAIL because `router_agent` does not import/register the tool yet.

- [ ] **Step 3: Write minimal implementation**

```python
from tools.minsk_datetime_tool import minsk_datetime_tool
...
tools=[..., minsk_datetime_tool]
```

- [ ] **Step 4: Run focused verification**

Run: `pytest tests/test_minsk_datetime_tool.py tests/test_gemini_model_aliases.py -v`
Expected: PASS
