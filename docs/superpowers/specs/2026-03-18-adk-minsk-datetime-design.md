# ADK Minsk Datetime Design

**Date:** 2026-03-18

**Goal:** Add one ADK tool that returns the current Minsk date and time, and make the router agent remember that Minsk time mode is enabled after the first time-related request.

## Context

The active ADK entrypoint is `router_agent/agent.py`. Tools are attached directly to the `LlmAgent`, and ADK session state is persisted through `InMemorySessionService`.

The user wants:

- one datetime tool instead of separate date/time tools
- Minsk (`Europe/Minsk`) as the canonical timezone
- the agent to switch into a Minsk-time-aware mode after the first date/time-related request
- later time-sensitive answers to trigger a fresh datetime lookup instead of relying on stale cached timestamps

## Approved Architecture

Add a new `FunctionTool` at `tools/minsk_datetime_tool.py` that:

- returns the current datetime for `Europe/Minsk`
- writes `user:timezone = "Europe/Minsk"`
- writes `user:minsk_time_enabled = true`

Update `router_agent/agent.py` to:

- register the new tool
- add a `before_model_callback` that detects time-related user turns and enables Minsk time mode in state
- append a dynamic instruction telling the model to call the Minsk datetime tool whenever the current answer depends on the current date or time

Keep the existing ADK service unchanged.

## State Model

Persistent user/session behavior is driven by ADK state:

- `user:timezone = "Europe/Minsk"`
- `user:minsk_time_enabled = true`

No persistent timestamp is stored, because a cached timestamp becomes incorrect quickly. Only the mode is remembered; fresh time is fetched per relevant turn.

## Error Handling

The Minsk datetime tool should be local-only and should not depend on external APIs. It should use Python timezone support and return structured text/dict output. The only realistic failures are local timezone/runtime errors, which should surface as a clear text error payload.

## Testing

Add focused tests for:

- tool output containing Minsk timezone data and enabling state
- callback detection of the first time-related request
- router wiring of the new tool and callback logic
- regression coverage so the TTS guard only limits repeated TTS calls, not unrelated tools
