import pytest
from google.genai import types

from yuzik_workflow.image_workflow import (
    ImagePromptResult,
    add_image_context,
    execute_image_route,
    image_prompt_source_text,
)


class FakeRequest:
    def __init__(self):
        self.instructions = []

    def append_instructions(self, instructions):
        self.instructions.extend(instructions)


class FakeContext:
    def __init__(self, state):
        self.state = state


@pytest.mark.asyncio
async def test_image_route_uses_english_prompt_and_caption():
    image = types.Part(inline_data=types.Blob(data=b"png", mime_type="image/png"))

    async def prompt_builder(text):
        assert "cat" in text
        return ImagePromptResult(
            prompt_en="A cat in a cosmonaut helmet",
            caption_be="Image ready.",
        )

    async def generate(**kwargs):
        assert kwargs["prompt"] == "A cat in a cosmonaut helmet"
        return image

    state = {"temp:yuzik_text": "draw a cat in a cosmonaut helmet"}

    parts = await execute_image_route(
        state=state,
        tool_context=object(),
        build_prompt=prompt_builder,
        generate=generate,
    )

    assert parts == [image]
    assert state["temp:primary_text"] == "Image ready."
    assert state["temp:image_prompt_en"] == "A cat in a cosmonaut helmet"


@pytest.mark.asyncio
async def test_image_route_uses_prompt_agent_output_from_workflow_node():
    image = types.Part(inline_data=types.Blob(data=b"png", mime_type="image/png"))
    captured = {}

    async def generate(**kwargs):
        captured["prompt"] = kwargs["prompt"]
        return image

    state = {"temp:yuzik_text": "draw a cat"}

    parts = await execute_image_route(
        state=state,
        tool_context=object(),
        prompt_result={
            "prompt_en": "A cheerful orange cat on a windowsill",
            "caption_be": "Here is the cat.",
        },
        generate=generate,
    )

    assert parts == [image]
    assert captured["prompt"] == "A cheerful orange cat on a windowsill"
    assert state["temp:primary_text"] == "Here is the cat."
    assert state["temp:image_prompt_en"] == "A cheerful orange cat on a windowsill"


def test_image_prompt_source_text_includes_structured_previous_text():
    state = {
        "temp:yuzik_text": "make an image based on it",
        "temp:turn_previous_text": "A lighthouse on a cliff during a storm.",
    }

    source_text = image_prompt_source_text(state)

    assert "make an image based on it" in source_text
    assert "previous_text" in source_text
    assert "A lighthouse on a cliff" in source_text


def test_image_context_callback_adds_previous_context_instruction():
    request = FakeRequest()
    context = FakeContext(
        {
            "temp:turn_previous_text": "A lighthouse on a cliff.",
            "temp:turn_previous_summary": None,
        }
    )

    add_image_context(context, request)

    assert request.instructions
    assert "previous_text" in request.instructions[0]
    assert "A lighthouse on a cliff" in request.instructions[0]


@pytest.mark.asyncio
async def test_image_route_skips_tts_when_both_flags_requested():
    async def prompt_builder(text):
        return ImagePromptResult(prompt_en="A cat", caption_be="Cat.")

    async def generate(**kwargs):
        return types.Part(inline_data=types.Blob(data=b"png", mime_type="image/png"))

    state = {
        "temp:yuzik_text": "draw and read aloud",
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
