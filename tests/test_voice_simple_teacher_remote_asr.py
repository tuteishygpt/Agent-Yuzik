import asyncio
import importlib
import os
import sys
import time
from types import ModuleType, SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_voice_simple_for_teacher(monkeypatch, controller):
    fake_deps = ModuleType("api.deps")
    fake_deps.get_genai_client = lambda: None
    monkeypatch.setitem(sys.modules, "api.deps", fake_deps)

    fake_teacher_service = ModuleType("api.teacher_mode.service")
    fake_teacher_service.controller = controller
    monkeypatch.setitem(sys.modules, "api.teacher_mode.service", fake_teacher_service)

    fake_voice_history = ModuleType("api.voice_history")
    fake_voice_history.get_voice_history = lambda user_id: SimpleNamespace(
        turn_count=0,
        to_gemini_contents=lambda: [],
    )
    monkeypatch.setitem(sys.modules, "api.voice_history", fake_voice_history)

    fake_voice_perf = ModuleType("api.voice_perf")
    fake_voice_perf.PerfLogger = object
    monkeypatch.setitem(sys.modules, "api.voice_perf", fake_voice_perf)

    fake_voice_utils = ModuleType("api.voice_utils")
    fake_voice_utils.LOCAL_SAMPLE_RATE = 16000
    fake_voice_utils.compress_wav_to_mp3 = lambda audio_data: b"mp3"
    monkeypatch.setitem(sys.modules, "api.voice_utils", fake_voice_utils)

    fake_tts = ModuleType("tools.text_to_speech_tool")

    async def _unused_stream_speech(*args, **kwargs):
        if False:
            yield b""

    async def _stream_speech_multi(sentence_queue, cancel_event=None, **kwargs):
        while True:
            sentence = await sentence_queue.get()
            if sentence is None:
                return
            yield b"audio"

    fake_tts.stream_speech = _unused_stream_speech
    fake_tts.stream_speech_multi = _stream_speech_multi
    monkeypatch.setitem(sys.modules, "tools.text_to_speech_tool", fake_tts)

    sys.modules.pop("api.voice_simple", None)
    return importlib.import_module("api.voice_simple")


def test_teacher_mode_ignores_local_asr_setting(monkeypatch):
    captured = {}

    class TeacherController:
        def get_state(self, *, session_id, user_id):
            return SimpleNamespace(lesson_id="basics_greetings", current_step_id="intro")

        async def process_audio_turn(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                transcript="remote transcript",
                normalized_transcript="remote transcript",
                reply_text="Dobry dzien!",
                teacher_action=SimpleNamespace(value="repeat_question"),
                step_id="intro",
                fallback_reason=None,
            )

    voice_simple = _load_voice_simple_for_teacher(monkeypatch, TeacherController())
    monkeypatch.setattr(voice_simple.config, "LOCAL_ASR", True)

    fake_local_asr = ModuleType("api.local_asr")
    fake_local_asr.is_ready = lambda: True

    def fail_transcribe(audio_data):
        raise AssertionError("teacher mode must not call local ASR")

    fake_local_asr.transcribe_wav_bytes = fail_transcribe
    monkeypatch.setitem(sys.modules, "api.local_asr", fake_local_asr)

    sent_messages = []

    websocket = SimpleNamespace(send_json=lambda payload: sent_messages.append(payload))

    async def send_json(payload):
        sent_messages.append(payload)

    websocket.send_json = send_json

    async def perf(*args, **kwargs):
        return None

    perf.start_ts = time.time()

    asyncio.run(
        voice_simple.handle_simple_voice(
            audio_data=b"wav",
            websocket=websocket,
            audio_queue=asyncio.Queue(),
            perf=perf,
            user_id="u1",
            ws_session_id="s1",
        )
    )

    assert captured["transcript"] == ""
    assert sent_messages[0] == {"type": "transcription", "text": "remote transcript"}
