from __future__ import annotations

import asyncio

from google.genai import types

try:
    from google.adk.workflow._errors import NodeInterruptedError, NodeTimeoutError
except Exception:  # pragma: no cover - ADK 1 fallback during partial installs
    class NodeInterruptedError(BaseException):
        pass

    class NodeTimeoutError(Exception):
        pass


DEFAULT_ERROR_REPLY = "Прабачце, нешта пайшло не так. Паспрабуйце яшчэ раз."
DEFAULT_TIMEOUT_REPLY = "Прабачце, адказ заняў занадта шмат часу. Паспрабуйце яшчэ раз."


def fallback_for_exception(
    exc: Exception,
    *,
    timeout_reply: str | None = None,
    error_reply: str | None = None,
) -> tuple[str, str]:
    if isinstance(exc, NodeInterruptedError):
        raise exc
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError, NodeTimeoutError)):
        return timeout_reply or DEFAULT_TIMEOUT_REPLY, exc.__class__.__name__
    return error_reply or DEFAULT_ERROR_REPLY, exc.__class__.__name__


async def error_fallback_node(ctx, node_input=None):
    exc = getattr(ctx, "error", None)
    if exc is None:
        return node_input
    reply, error_type = fallback_for_exception(exc)
    ctx.state["temp:error"] = str(exc)
    ctx.state["temp:error_type"] = error_type
    return types.Content(role="model", parts=[types.Part(text=reply)])
