import asyncio
import importlib
import os
import sys
from types import SimpleNamespace

from google.genai import types


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_module(monkeypatch):
    sys.modules.pop("tools.gemini_image_generator", None)
    return importlib.import_module("tools.gemini_image_generator")


def test_generate_image_rejects_multiple_images(monkeypatch):
    module = _load_module(monkeypatch)

    class FakeToolContext:
        async def save_artifact(self, filename, artifact):
            raise AssertionError("save_artifact should not be called")

    async def run():
        return await module.generate_image(
            prompt="cat",
            number_of_images=2,
            tool_context=FakeToolContext(),
        )

    result = asyncio.run(run())

    assert result.text
    assert "number_of_images" in result.text


def test_generate_image_uses_configured_model_and_saves_first_image(monkeypatch):
    module = _load_module(monkeypatch)
    monkeypatch.setattr(module.config, "IMAGE_GENERATION_MODEL", "custom-image-model")
    monkeypatch.setattr(module.config, "GEMINI_API_KEY", "test-key")

    captured = {}
    image_part = types.Part.from_bytes(data=b"png-bytes", mime_type="image/png")

    async def fake_generate_parts(**kwargs):
        captured.update(kwargs)
        return [types.Part(text="ignored"), image_part]

    monkeypatch.setattr(module, "_generate_gemini_parts", fake_generate_parts)

    class FakeToolContext:
        async def save_artifact(self, filename, artifact):
            captured["filename"] = filename
            captured["artifact"] = artifact
            return types.Part(text=f"saved:{filename}")

    async def run():
        return await module.generate_image(
            prompt="sunrise over Minsk",
            aspect_ratio="16:9",
            person_generation="ALLOW_ADULT",
            output_mime_type="image/png",
            tool_context=FakeToolContext(),
        )

    result = asyncio.run(run())

    assert result.text.startswith("saved:")
    assert captured["model"] == "custom-image-model"
    assert captured["prompt"] == "sunrise over Minsk"
    assert captured["aspect_ratio"] == "16:9"
    assert captured["person_generation"] == "ALLOW_ADULT"
    assert captured["output_mime_type"] == "image/png"
    assert captured["filename"].startswith("gemini_")
    assert captured["artifact"].inline_data.data == b"png-bytes"
    assert captured["artifact"].inline_data.mime_type == "image/png"


def test_generate_image_returns_text_error_when_no_image_part_exists(monkeypatch):
    module = _load_module(monkeypatch)
    monkeypatch.setattr(module.config, "GEMINI_API_KEY", "test-key")

    async def fake_generate_parts(**kwargs):
        return [types.Part(text="only text")]

    monkeypatch.setattr(module, "_generate_gemini_parts", fake_generate_parts)

    class FakeToolContext:
        async def save_artifact(self, filename, artifact):
            raise AssertionError("save_artifact should not be called")

    async def run():
        return await module.generate_image(
            prompt="forest",
            tool_context=FakeToolContext(),
        )

    result = asyncio.run(run())

    assert result.text
    assert "No image" in result.text


def test_generate_gemini_parts_omits_unsupported_gemini_api_image_fields(monkeypatch):
    module = _load_module(monkeypatch)
    monkeypatch.setattr(module.config, "GEMINI_API_KEY", "test-key")

    captured = {}
    image_part = types.Part.from_bytes(data=b"png-bytes", mime_type="image/png")

    class FakeResponse:
        parts = [image_part]

    class FakeModels:
        async def generate_content(self, *, model, contents, config):
            captured["model"] = model
            captured["contents"] = contents
            captured["config"] = config
            return FakeResponse()

    class FakeAio:
        models = FakeModels()

    class FakeClient:
        aio = FakeAio()

    class FakeImageConfig:
        def __init__(self, **kwargs):
            self.aspect_ratio = kwargs.get("aspect_ratio")
            self.person_generation = kwargs.get("person_generation")
            self.output_mime_type = kwargs.get("output_mime_type")

    class FakeGenerateContentConfig:
        def __init__(self, **kwargs):
            self.response_modalities = kwargs.get("response_modalities")
            self.image_config = kwargs.get("image_config")

    monkeypatch.setattr(module, "_get_genai_client", lambda: FakeClient())
    monkeypatch.setattr(
        module,
        "types",
        SimpleNamespace(
            ImageConfig=FakeImageConfig,
            GenerateContentConfig=FakeGenerateContentConfig,
            Part=types.Part,
        ),
    )

    async def run():
        return await module._generate_gemini_parts(
            model="gemini-2.5-flash-image",
            prompt="sunrise",
            aspect_ratio="16:9",
            person_generation="ALLOW_ADULT",
            output_mime_type="image/png",
        )

    result = asyncio.run(run())

    assert result == [image_part]
    assert captured["model"] == "gemini-2.5-flash-image"
    assert captured["contents"] == "sunrise"
    assert captured["config"].response_modalities == ["IMAGE"]
    assert captured["config"].image_config.aspect_ratio == "16:9"
    assert captured["config"].image_config.person_generation is None
    assert captured["config"].image_config.output_mime_type is None
