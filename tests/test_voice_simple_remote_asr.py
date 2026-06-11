import asyncio
import os
import sys
from types import SimpleNamespace
from unittest.mock import mock_open

from fastapi.websockets import WebSocketState

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import api.voice_simple as voice_simple
import api


class _FakeWebSocket:
    def __init__(self):
        self.client_state = WebSocketState.CONNECTED
        self.messages = []

    async def send_json(self, payload):
        self.messages.append(payload)


class _FakeVoiceHistory:
    def __init__(self):
        self.turn_count = 0
        self.saved_turns = []

    def to_gemini_contents(self):
        return []

    def add_turn(self, user_text, assistant_text):
        self.saved_turns.append((user_text, assistant_text))
        self.turn_count += 1


class _FakeResponseStream:
    def __init__(self, texts):
        self._texts = texts

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for text in self._texts:
            yield SimpleNamespace(text=text)


class _FakePerf:
    def __init__(self):
        self.start_ts = 0.0

    async def __call__(self, *args, **kwargs):
        return None


def test_remote_asr_transcription_is_sent_to_gemini(monkeypatch):
    captured = {}
    fake_history = _FakeVoiceHistory()

    monkeypatch.setattr(voice_simple.config, "LOCAL_ASR", False)
    monkeypatch.setattr(voice_simple.config, "TTS_MODE", "api")
    monkeypatch.setattr(voice_simple.config, "TTS_FIRST_SEGMENT_LIMIT", 1)
    monkeypatch.setattr(
        voice_simple,
        "_transcribe_audio_with_model",
        lambda audio: asyncio.sleep(0, result="recognized text"),
    )
    monkeypatch.setattr(voice_simple, "get_voice_history", lambda user_id: fake_history)

    async def fake_stream_speech_multi(sentence_queue, cancel_event=None):
        while True:
            item = await sentence_queue.get()
            if item is None:
                break
            yield b"audio"

    monkeypatch.setattr(voice_simple, "stream_speech_multi", fake_stream_speech_multi)
    monkeypatch.setattr("builtins.open", mock_open())

    class _FakeModels:
        async def generate_content_stream(self, *, model, contents, config):
            captured["model"] = model
            captured["contents"] = contents
            captured["config"] = config
            return _FakeResponseStream(["Адказ."])

    fake_client = SimpleNamespace(aio=SimpleNamespace(models=_FakeModels()))
    monkeypatch.setattr(voice_simple, "get_genai_client", lambda: fake_client)

    async def scenario():
        websocket = _FakeWebSocket()
        audio_queue = asyncio.Queue()
        await voice_simple.handle_simple_voice(
            audio_data=b"wav-bytes",
            websocket=websocket,
            audio_queue=audio_queue,
            perf=_FakePerf(),
            user_id="voice-user",
            ws_session_id="session-id",
        )
        captured["messages"] = websocket.messages

    asyncio.run(scenario())

    current_part = captured["contents"][-1].parts[0]
    assert current_part.inline_data.mime_type == "audio/wav"
    assert current_part.inline_data.data == b"wav-bytes"
    assert {"type": "transcription", "text": "recognized text"} in captured["messages"]
    assert fake_history.saved_turns[0][0] == "recognized text"


def test_local_asr_load_failure_falls_back_to_remote_transcription(monkeypatch):
    captured = {}

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
    monkeypatch.setattr(
        voice_simple,
        "_transcribe_audio_with_model",
        lambda audio: asyncio.sleep(0, result="remote text"),
    )
    monkeypatch.setitem(sys.modules, "api.local_asr", _FakeLocalAsr)
    monkeypatch.setattr(api, "local_asr", _FakeLocalAsr, raising=False)

    async def scenario():
        websocket = _FakeWebSocket()
        content_text, content, remote_asr_task = await voice_simple._transcribe_and_build_content(
            audio_data=b"wav-bytes",
            websocket=websocket,
            perf=_FakePerf(),
            start_ts=0.0,
        )
        captured["content_text"] = content_text
        captured["content"] = content
        captured["remote_asr_task"] = remote_asr_task
        captured["messages"] = websocket.messages

    asyncio.run(scenario())

    assert captured["content_text"] == "remote text"
    assert captured["content"].parts[0].text == "remote text"
    assert captured["remote_asr_task"] is None
    assert captured["messages"][-1] == {"type": "transcription", "text": "remote text"}
