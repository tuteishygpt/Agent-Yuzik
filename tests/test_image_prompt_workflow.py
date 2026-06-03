import pytest
from google.genai import types

from yuzik_workflow.image_workflow import ImagePromptResult, execute_image_route


@pytest.mark.asyncio
async def test_image_route_uses_english_prompt_and_belarusian_caption():
    image = types.Part(inline_data=types.Blob(data=b"png", mime_type="image/png"))

    async def prompt_builder(text):
        assert "ката" in text
        return ImagePromptResult(
            prompt_en="A cat in a cosmonaut helmet",
            caption_be="Вось малюнак ката ў касманаўцкім шлеме.",
        )

    async def generate(**kwargs):
        assert kwargs["prompt"] == "A cat in a cosmonaut helmet"
        return image

    state = {"temp:yuzik_text": "намалюй ката ў касманаўцкім шлеме"}

    parts = await execute_image_route(
        state=state,
        tool_context=object(),
        build_prompt=prompt_builder,
        generate=generate,
    )

    assert parts == [image]
    assert state["temp:primary_text"] == "Вось малюнак ката ў касманаўцкім шлеме."
    assert state["temp:image_prompt_en"] == "A cat in a cosmonaut helmet"


@pytest.mark.asyncio
async def test_image_route_skips_tts_when_both_flags_requested():
    async def prompt_builder(text):
        return ImagePromptResult(prompt_en="A cat", caption_be="Кот.")

    async def generate(**kwargs):
        return types.Part(inline_data=types.Blob(data=b"png", mime_type="image/png"))

    state = {
        "temp:yuzik_text": "намалюй і агучы",
        "temp:tts_requested": True,
    }

    await execute_image_route(
        state=state,
        tool_context=object(),
        build_prompt=prompt_builder,
        generate=generate,
    )

    assert state["temp:tts_requested"] is False
    assert state["temp:diagnostics"]["tts_skipped_for_image"] is True
