import pytest
from google.genai import types

from yuzik_workflow.post_actions import maybe_run_tts_post_action


@pytest.mark.asyncio
async def test_tts_post_action_skips_when_not_requested():
    state = {"temp:tts_requested": False, "temp:primary_text": "Прывітанне"}
    called = False

    async def synthesize(**kwargs):
        nonlocal called
        called = True

    result = await maybe_run_tts_post_action(
        state=state,
        parts=[],
        tool_context=object(),
        synthesize=synthesize,
    )

    assert result == []
    assert called is False


@pytest.mark.asyncio
async def test_tts_post_action_appends_audio_and_artifact_delta():
    state = {"temp:tts_requested": True, "temp:primary_text": "Прывітанне"}
    audio = types.Part(inline_data=types.Blob(data=b"wav", mime_type="audio/wav"))

    async def synthesize(**kwargs):
        assert kwargs["text"] == "Прывітанне"
        return audio

    result = await maybe_run_tts_post_action(
        state=state,
        parts=[],
        tool_context=object(),
        synthesize=synthesize,
    )

    assert result == [audio]
    assert state["temp:artifact_delta"]["tts_output.wav"] == 0


@pytest.mark.asyncio
async def test_tts_post_action_uses_output_parts_before_postprocess_sets_state_text():
    state = {"temp:tts_requested": True}
    audio = types.Part(inline_data=types.Blob(data=b"wav", mime_type="audio/wav"))
    parts = [types.Part(text="Hello")]

    async def synthesize(**kwargs):
        assert kwargs["text"] == "Hello"
        return audio

    result = await maybe_run_tts_post_action(
        state=state,
        parts=parts,
        tool_context=object(),
        synthesize=synthesize,
    )

    assert result == [parts[0], audio]
    assert state["temp:artifact_delta"]["tts_output.wav"] == 0
    assert state["temp:tts_requested"] is False


@pytest.mark.asyncio
async def test_tts_post_action_skips_cancelled_creation():
    state = {
        "temp:tts_requested": True,
        "temp:primary_text": "Прывітанне",
        "temp:creation_cancelled": True,
    }

    async def synthesize(**kwargs):
        raise AssertionError("cancelled requests must not synthesize")

    assert await maybe_run_tts_post_action(
        state=state,
        parts=[],
        tool_context=object(),
        synthesize=synthesize,
    ) == []
