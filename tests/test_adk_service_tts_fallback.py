from google.genai import types

from services.adk_service import ADKService
from services.adk_service import _tts_requested_from_state_delta


class FakeArtifactService:
    def __init__(self):
        self.saved = []

    async def save_artifact(self, **kwargs):
        self.saved.append(kwargs)
        return 4


def test_service_tts_detection_reads_persistent_turn_state_delta():
    assert _tts_requested_from_state_delta({"user:tts_requested_for_turn": True}) is True
    assert _tts_requested_from_state_delta({"temp:tts_requested": True}) is True
    assert _tts_requested_from_state_delta({"user:tts_requested_for_turn": False}) is False


def test_service_tts_fallback_saves_artifact_and_appends_audio(monkeypatch):
    import tools.text_to_speech_tool as tts_module

    service = ADKService.__new__(ADKService)
    service.app_name = "yuzik_workflow"
    service.artifact_service = FakeArtifactService()

    async def synthesize_speech(*, text, tool_context):
        assert text == "Hello"
        audio = types.Part.from_bytes(data=b"wav", mime_type="audio/wav")
        return await tool_context.save_artifact(
            filename="tts_output.wav",
            artifact=audio,
        )

    monkeypatch.setattr(tts_module, "synthesize_speech", synthesize_speech)

    delta = {}
    parts = [types.Part(text="Hello")]

    service._maybe_run_service_tts_post_action(
        user_id="user-1",
        session_id="session-1",
        text="read aloud this",
        reply="Hello",
        final_parts=parts,
        delta=delta,
        tts_requested=True,
    )

    assert delta == {"tts_output.wav": 4}
    assert len(parts) == 2
    assert parts[1].inline_data.mime_type == "audio/wav"
    assert parts[1].inline_data.data == b"wav"
    assert service.artifact_service.saved[0]["app_name"] == "yuzik_workflow"
    assert service.artifact_service.saved[0]["user_id"] == "user-1"
    assert service.artifact_service.saved[0]["session_id"] == "session-1"


def test_service_tts_fallback_skips_when_workflow_already_saved_tts(monkeypatch):
    import tools.text_to_speech_tool as tts_module

    service = ADKService.__new__(ADKService)
    service.app_name = "yuzik_workflow"
    service.artifact_service = FakeArtifactService()

    def fail_if_called(**kwargs):
        _ = kwargs
        raise AssertionError("service fallback must not synthesize duplicate TTS")

    monkeypatch.setattr(tts_module, "synthesize_speech", fail_if_called)

    delta = {"tts_output.wav": 4}
    parts = [types.Part(text="Hello")]

    service._maybe_run_service_tts_post_action(
        user_id="user-1",
        session_id="session-1",
        text="read aloud this",
        reply="Hello",
        final_parts=parts,
        delta=delta,
        tts_requested=True,
    )

    assert delta == {"tts_output.wav": 4}
    assert parts == [types.Part(text="Hello")]


def test_service_tts_fallback_uses_explicit_target_text(monkeypatch):
    import tools.text_to_speech_tool as tts_module

    service = ADKService.__new__(ADKService)
    service.app_name = "yuzik_workflow"
    service.artifact_service = FakeArtifactService()

    async def synthesize_speech(*, text, tool_context):
        assert text == "Hello"
        audio = types.Part.from_bytes(data=b"wav", mime_type="audio/wav")
        return await tool_context.save_artifact(
            filename="tts_output.wav",
            artifact=audio,
        )

    monkeypatch.setattr(tts_module, "synthesize_speech", synthesize_speech)

    delta = {}
    parts = [types.Part(text="I cannot create audio.")]

    service._maybe_run_service_tts_post_action(
        user_id="user-1",
        session_id="session-1",
        text="read aloud text: Hello",
        reply="I cannot create audio.",
        final_parts=parts,
        delta=delta,
        tts_requested=True,
    )

    assert parts[0].text == "Hello"
    assert parts[1].inline_data.mime_type == "audio/wav"
    assert delta == {"tts_output.wav": 4}


def test_service_tts_fallback_preserves_reply_for_contextual_tts_request(monkeypatch):
    import tools.text_to_speech_tool as tts_module

    service = ADKService.__new__(ADKService)
    service.app_name = "yuzik_workflow"
    service.artifact_service = FakeArtifactService()
    forecast = "Зараз у Мінску пахмурна, тэмпература 15°C, дзьме моцны вецер."

    async def synthesize_speech(*, text, tool_context):
        assert text == forecast
        audio = types.Part.from_bytes(data=b"wav", mime_type="audio/wav")
        return await tool_context.save_artifact(
            filename="tts_output.wav",
            artifact=audio,
        )

    monkeypatch.setattr(tts_module, "synthesize_speech", synthesize_speech)

    delta = {}
    parts = [types.Part(text=forecast)]

    service._maybe_run_service_tts_post_action(
        user_id="user-1",
        session_id="session-1",
        text="Агуч прагноз",
        reply=forecast,
        final_parts=parts,
        delta=delta,
        tts_requested=True,
    )

    assert parts[0].text == forecast
    assert parts[1].inline_data.mime_type == "audio/wav"
    assert delta == {"tts_output.wav": 4}
