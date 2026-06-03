# ADK 2 workflow API audit

Verified against `google-adk 2.1.0`.

- Workflow imports live under `google.adk.workflow`, not `google.adk.workflows`.
- Use `Workflow`, `BaseNode`, `FunctionNode`, `node`, `RetryConfig` from `google.adk.workflow`.
- `NodeInterruptedError` and `NodeTimeoutError` live in `google.adk.workflow._errors`.
- Graphs are defined with `Workflow(name=..., edges=[(START, node_a, node_b)])`.
- Python functions become graph nodes with `@node`; an existing `LlmAgent` is already a `BaseNode` and can be used directly in `edges`.
- State passes through `ctx.state`; function-node parameters are bound from state by default, and `node_input` can receive the prior node output.
- `Runner` accepts graph workflows via `Runner(node=workflow, ...)`; `Runner(agent=workflow, ...)` also constructs, but `node=` is the explicit ADK 2 workflow path.
- `run_agent_stream` remains on the existing `router_agent` runner. The current voice path uses synchronous `Runner.run()` in an executor, not ADK `run_live`; workflow live compatibility is not used for C1.

`ADKSessionStore` is an active-session mapping only. It stores `user_id`, `conversation_id`, `adk_app_name`, `adk_session_id`, status, and timestamps. Runtime sessions use `InMemorySessionService`; no ADK event table, rigid event columns, or JSON event persistence exists, so no Supabase migration is required for `node_info` or `output` fields.
