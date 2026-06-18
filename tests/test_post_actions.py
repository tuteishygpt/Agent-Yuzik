import pytest
from google.genai import types

from yuzik_workflow.post_actions import maybe_run_tts_post_action


@pytest.mark.asyncio
async def test_tts_post_action_records_not_requested_diagnostics():
    state = {"temp:tts_requested": False, "temp:primary_text": "Primary answer"}
    called = False

    async def synthesize(**kwargs):
        nonlocal called
        called = True

    parts = [types.Part(text="Primary answer")]

    result = await maybe_run_tts_post_action(
        state=state,
        parts=parts,
        tool_context=object(),
        synthesize=synthesize,
    )

    assert result == parts
    assert called is False
    assert state["temp:primary_text"] == "Primary answer"
    assert state["temp:post_action_diagnostics"]["tts"] == {
        "requested": False,
        "executed": False,
        "skipped": True,
        "skip_reason": "not_requested",
    }


@pytest.mark.asyncio
async def test_tts_post_action_records_executed_diagnostics_without_erasing_answer():
    state = {"temp:tts_requested": True, "temp:primary_text": "Primary answer"}
    audio = types.Part(inline_data=types.Blob(data=b"wav", mime_type="audio/wav"))

    async def synthesize(**kwargs):
        return audio

    result = await maybe_run_tts_post_action(
        state=state,
        parts=[types.Part(text="Visible answer")],
        tool_context=object(),
        synthesize=synthesize,
    )

    assert result[-1] is audio
    assert state["temp:primary_text"] == "Primary answer"
    assert state["temp:post_action_diagnostics"]["tts"] == {
        "requested": True,
        "executed": True,
        "skipped": False,
        "skip_reason": None,
    }


@pytest.mark.asyncio
async def test_tts_post_action_records_cancelled_skip_diagnostics():
    state = {
        "temp:tts_requested": True,
        "temp:primary_text": "Primary answer",
        "temp:creation_cancelled": True,
    }

    async def synthesize(**kwargs):
        raise AssertionError("cancelled requests must not synthesize")

    await maybe_run_tts_post_action(
        state=state,
        parts=[],
        tool_context=object(),
        synthesize=synthesize,
    )

    assert state["temp:primary_text"] == "Primary answer"
    assert state["temp:post_action_diagnostics"]["tts"] == {
        "requested": True,
        "executed": False,
        "skipped": True,
        "skip_reason": "creation_cancelled",
    }
