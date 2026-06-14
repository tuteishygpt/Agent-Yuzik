from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor as RealThreadPoolExecutor

import pytest
from google.adk.events import Event
from google.genai import types

import config
from services.adk_service import ADKEventError, ADKService


def test_run_agent_raises_adk_event_error_from_event_error_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ADKService()

    def run_with_error_event(**kwargs):
        _ = kwargs
        yield Event(
            author="router_agent",
            error_code="MODEL_ERROR",
            error_message="model could not produce a response",
        )

    monkeypatch.setattr(service.runner, "run", run_with_error_event)

    with pytest.raises(ADKEventError) as exc_info:
        service.run_agent(
            session_id="session-1",
            user_id="auth-user-123",
            text="hello",
        )

    assert exc_info.value.error_code == "MODEL_ERROR"
    assert str(exc_info.value) == "model could not produce a response"


def test_run_agent_stream_yields_fallback_event_from_event_error_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ADKService()

    def run_with_error_event(**kwargs):
        _ = kwargs
        yield Event(
            author="router_agent",
            error_code="MODEL_ERROR",
            error_message="model could not produce a response",
        )

    monkeypatch.setattr(service.streaming_runner, "run", run_with_error_event)

    async def collect_text() -> list[str]:
        texts: list[str] = []
        async for ev in service.run_agent_stream(
            session_id="session-1",
            user_id="auth-user-123",
            text="hello",
        ):
            if ev.content and ev.content.parts:
                texts.extend(part.text for part in ev.content.parts if part.text)
        return texts

    assert asyncio.run(collect_text()) == [config.DEFAULT_ERROR]


def test_run_agent_stream_shuts_down_executor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import services.adk_service as adk_service_module

    shutdown_calls: list[dict[str, object]] = []

    class TrackingExecutor:
        def __init__(self, *args, **kwargs):
            self._executor = RealThreadPoolExecutor(*args, **kwargs)

        def submit(self, *args, **kwargs):
            return self._executor.submit(*args, **kwargs)

        def shutdown(self, *args, **kwargs):
            shutdown_calls.append(kwargs)
            return self._executor.shutdown(*args, **kwargs)

    service = ADKService()

    def run_with_final_event(**kwargs):
        _ = kwargs
        yield Event(
            author="router_agent",
            content=types.Content(
                role="model",
                parts=[types.Part(text="hello")],
            ),
            turnComplete=True,
        )

    monkeypatch.setattr(service.streaming_runner, "run", run_with_final_event)
    monkeypatch.setattr(adk_service_module, "ThreadPoolExecutor", TrackingExecutor)

    async def drain() -> list[str]:
        texts: list[str] = []
        async for ev in service.run_agent_stream(
            session_id="session-1",
            user_id="auth-user-123",
            text="hello",
        ):
            if ev.content and ev.content.parts:
                texts.extend(part.text for part in ev.content.parts if part.text)
        return texts

    assert asyncio.run(drain()) == ["hello"]
    assert shutdown_calls
    assert shutdown_calls[-1]["wait"] is False
