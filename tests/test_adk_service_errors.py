from __future__ import annotations

import asyncio

import pytest
from google.adk.events import Event

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
