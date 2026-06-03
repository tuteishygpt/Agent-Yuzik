import asyncio

import pytest

from yuzik_workflow.errors import fallback_for_exception


def test_timeout_fallback_uses_request_reply_and_type():
    reply, error_type = fallback_for_exception(
        asyncio.TimeoutError(),
        timeout_reply="Час выйшаў.",
    )

    assert reply == "Час выйшаў."
    assert error_type == "TimeoutError"


def test_generic_error_fallback_uses_request_reply_and_type():
    reply, error_type = fallback_for_exception(
        RuntimeError("boom"),
        error_reply="Памылка.",
    )

    assert reply == "Памылка."
    assert error_type == "RuntimeError"


def test_node_interrupted_error_is_not_swallowed():
    try:
        from google.adk.workflow._errors import NodeInterruptedError
    except Exception:
        pytest.skip("ADK 2 workflow errors are unavailable")

    with pytest.raises(NodeInterruptedError):
        fallback_for_exception(NodeInterruptedError())
