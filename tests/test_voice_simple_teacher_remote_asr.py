import asyncio
import os
import sys
from types import SimpleNamespace

from fastapi.websockets import WebSocketState

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import api.voice_simple as voice_simple
import api.voice_teacher as voice_teacher
import api
from api.teacher_mode.models import TeacherAction


class _FakeWebSocket:
    def __init__(self):
        self.client_state = WebSocketState.CONNECTED
        self.messages = []

    async def send_json(self, payload):
        self.messages.append(payload)


class _FakePerf:
    def __init__(self):
        self.start_ts = 0.0

    async def __call__(self, *args, **kwargs):
        return None


class _FakeTeacherController:
    def __init__(self):
        self.process_calls = []

    def get_state(self, *, session_id: str, user_id: str):
        return SimpleNamespace(lesson_id="lesson-1", current_step_id="step-1")

    async def process_audio_turn(self, **kwargs):
        self.process_calls.append(kwargs)
        return SimpleNamespace(
            transcript=kwargs["transcript"],
            normalized_transcript=kwargs["transcript"].lower(),
            reply_text="Настаўніцкі адказ.",
            teacher_action=TeacherAction.repeat_question,
            step_id="step-1",
            fallback_reason=None,
        )


async def _fake_stream_speech_multi(sentence_queue, cancel_event=None):
    while True:
        item = await sentence_queue.get()
        if item is None:
            break
        yield b"audio"


def test_teacher_mode_uses_remote_transcription_when_local_asr_disabled(monkeypatch):
    fake_controller = _FakeTeacherController()

    monkeypatch.setattr(voice_simple.config, "LOCAL_ASR", False)
    monkeypatch.setattr(voice_teacher, "teacher_controller", fake_controller)
    monkeypatch.setattr(
        voice_teacher,
        "_transcribe_audio_with_model",
        lambda audio: asyncio.sleep(0, result="recognized student answer"),
    )
    monkeypatch.setattr(voice_simple, "stream_speech_multi", _fake_stream_speech_multi)

    async def scenario():
        websocket = _FakeWebSocket()
        audio_queue = asyncio.Queue()
        await voice_teacher.handle_teacher_voice(
            audio_data=b"wav-bytes",
            websocket=websocket,
            audio_queue=audio_queue,
            perf=_FakePerf(),
            start_ts=0.0,
            session_id="session-id",
            user_id="voice-user",
            teacher_state=SimpleNamespace(lesson_id="lesson-1", current_step_id="step-1"),
        )

    asyncio.run(scenario())

    assert fake_controller.process_calls[0]["transcript"] == "recognized student answer"


def test_teacher_local_asr_load_failure_falls_back_to_remote_transcription(monkeypatch):
    class _FakeLocalAsr:
        @staticmethod
        def is_ready():
            return False

        @staticmethod
        def load_asr_model():
            return None

        @staticmethod
        def transcribe_wav_bytes(audio):
            raise RuntimeError("ASR model is not loaded. Call load_asr_model() first.")

    monkeypatch.setattr(voice_simple.config, "LOCAL_ASR", True)
    monkeypatch.setattr(voice_teacher.config, "LOCAL_ASR", True)
    monkeypatch.setattr(
        voice_teacher,
        "_transcribe_audio_with_model",
        lambda audio: asyncio.sleep(0, result="remote teacher text"),
    )
    monkeypatch.setitem(sys.modules, "api.local_asr", _FakeLocalAsr)
    monkeypatch.setattr(api, "local_asr", _FakeLocalAsr, raising=False)

    transcript = asyncio.run(voice_teacher._transcribe_for_teacher(b"wav-bytes", start_ts=0.0))

    assert transcript == "remote teacher text"
