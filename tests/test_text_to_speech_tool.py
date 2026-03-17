import asyncio
import importlib
import os
import sys
from types import ModuleType

import httpx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_tts_module(monkeypatch):
    monkeypatch.setenv("TTS_MODE", "api")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HUGGINGFACE_API_TOKEN", raising=False)

    sys.modules.pop("config", None)
    sys.modules.pop("tools.text_to_speech_tool", None)

    fake_gradio_client = ModuleType("gradio_client")

    class DummyClient:
        def __init__(self, *args, **kwargs):
            self.src = "https://fake.space/"
            self.headers = {}
            self.cookies = {}
            self.ssl_verify = True
            self.httpx_kwargs = {}

        def predict(self, *args, **kwargs):
            return None

    fake_gradio_client.Client = DummyClient
    fake_gradio_client.handle_file = lambda path: {
        "path": path,
        "meta": {"_type": "gradio.FileData"},
    }
    monkeypatch.setitem(sys.modules, "gradio_client", fake_gradio_client)

    return importlib.import_module("tools.text_to_speech_tool")


def test_stream_speech_api_reads_audio_from_filedata_url(monkeypatch):
    wav_bytes = b"RIFFfake-wav-data"
    requested = {}

    class FakeResponse:
        def __init__(self, content):
            self.content = content

        def raise_for_status(self):
            return None

    def fake_httpx_get(url, **kwargs):
        requested["url"] = url
        requested["kwargs"] = kwargs
        return FakeResponse(wav_bytes)

    tts = _load_tts_module(monkeypatch)
    monkeypatch.setattr(httpx, "get", fake_httpx_get)

    class FakeJob:
        def __iter__(self):
            yield {
                "path": "/tmp/gradio/tts.wav",
                "url": "/gradio_api/file=/tmp/gradio/tts.wav",
                "meta": {"_type": "gradio.FileData"},
            }

    class FakeVoiceClient:
        src = "https://fake.space/"
        headers = {"Authorization": "Bearer test"}
        cookies = {"session": "cookie"}
        ssl_verify = True
        httpx_kwargs = {"timeout": 10}

        def submit(self, **kwargs):
            return FakeJob()

    monkeypatch.setattr(tts, "voice_client", FakeVoiceClient())

    async def collect():
        return [chunk async for chunk in tts._stream_speech_api("Прывітанне")]

    chunks = asyncio.run(collect())

    assert chunks == [wav_bytes]
    assert requested["url"] == "https://fake.space/gradio_api/file=/tmp/gradio/tts.wav"


def test_synthesize_api_uses_available_named_endpoint(monkeypatch):
    tts = _load_tts_module(monkeypatch)
    observed = {}

    class FakePredictClient:
        config = {"dependencies": [{"id": 0, "api_name": "text_to_speech"}]}

        class Endpoint:
            api_name = "/text_to_speech"
            is_valid = True
            backend_fn = 0
            show_api = True
            fn_index = 0
            parameters_info = [
                {
                    "label": "Text input",
                    "parameter_name": "text_input",
                    "component": "textbox",
                    "type": {},
                    "python_type": {},
                    "example_input": "Прывітанне",
                },
                {
                    "label": "Speaker audio",
                    "parameter_name": "speaker_audio",
                    "component": "audio",
                    "type": {},
                    "python_type": {},
                    "example_input": None,
                    "parameter_has_default": True,
                    "parameter_default": None,
                },
            ]

        endpoints = {0: Endpoint()}

        def predict(self, *args, **kwargs):
            api_name = kwargs.get("api_name")
            if api_name != "/text_to_speech":
                raise ValueError(
                    f"Cannot find a function with `api_name`: {api_name}."
                )
            if "belarusian_story" in kwargs or "speaker_audio_file" in kwargs:
                raise TypeError("Legacy keyword arguments should not be used.")
            observed["api_name"] = api_name
            observed["kwargs"] = kwargs
            return "/tmp/generated.wav"

    monkeypatch.setattr(tts, "gradio_client", FakePredictClient())

    async def synthesize():
        return await tts._synthesize_api("Прывітанне")

    result = asyncio.run(synthesize())

    assert result == "/tmp/generated.wav"
    assert observed["api_name"] == "/text_to_speech"
    assert observed["kwargs"]["text_input"] == "Прывітанне"
    assert observed["kwargs"]["speaker_audio"] is None


def test_synthesize_api_preserves_legacy_predict_signature(monkeypatch):
    tts = _load_tts_module(monkeypatch)
    observed = {}

    class FakePredictClient:
        config = {"dependencies": [{"id": 0, "api_name": "predict"}]}

        class Endpoint:
            api_name = "/predict"
            is_valid = True
            backend_fn = 0
            show_api = True
            fn_index = 0
            parameters_info = [
                {
                    "label": "Belarusian story",
                    "parameter_name": "belarusian_story",
                    "component": "textbox",
                    "type": {},
                    "python_type": {},
                    "example_input": "Прывітанне",
                },
                {
                    "label": "Speaker audio file",
                    "parameter_name": "speaker_audio_file",
                    "component": "audio",
                    "type": {},
                    "python_type": {},
                    "example_input": None,
                    "parameter_has_default": True,
                    "parameter_default": None,
                },
            ]

        endpoints = {0: Endpoint()}

        def predict(self, *args, **kwargs):
            observed["api_name"] = kwargs.get("api_name")
            observed["kwargs"] = kwargs
            return "/tmp/legacy.wav"

    monkeypatch.setattr(tts, "gradio_client", FakePredictClient())

    async def synthesize():
        return await tts._synthesize_api("Прывітанне")

    result = asyncio.run(synthesize())

    assert result == "/tmp/legacy.wav"
    assert observed["api_name"] == "/predict"
    assert observed["kwargs"]["belarusian_story"] == "Прывітанне"
    assert observed["kwargs"]["speaker_audio_file"] is None
