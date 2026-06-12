import asyncio

from google.genai import types

from yuzik_workflow.context import MAX_INLINE_PREVIOUS_TEXT_CHARS
from yuzik_workflow.postprocess import postprocess_node


class FakeContext:
    def __init__(self, state=None):
        self.state = state or {}


def test_postprocess_stores_generic_last_assistant_text_and_summary():
    ctx = FakeContext({"temp:yuzik_text": "tell me about Minsk"})
    answer = "Minsk is the capital of Belarus with wide avenues and parks."
    content = types.Content(role="model", parts=[types.Part(text=answer)])

    result = asyncio.run(postprocess_node(ctx, content))

    assert result is content
    assert ctx.state["user:last_assistant_text"] == answer
    assert ctx.state["user:last_assistant_summary"] == answer
    assert "user:last_story_text" not in ctx.state


def test_postprocess_stores_last_assistant_text_from_string_output():
    ctx = FakeContext({"temp:yuzik_text": "weather"})
    answer = "The weather in Minsk is cloudy and 15C."

    result = asyncio.run(postprocess_node(ctx, answer))

    assert result.parts[0].text == answer
    assert ctx.state["user:last_assistant_text"] == answer
    assert ctx.state["user:last_assistant_summary"] == answer


def test_postprocess_keeps_large_text_out_of_inline_previous_state():
    ctx = FakeContext()
    answer = "x" * (MAX_INLINE_PREVIOUS_TEXT_CHARS + 200)

    asyncio.run(postprocess_node(ctx, answer))

    assert "user:last_assistant_text" not in ctx.state
    assert len(ctx.state["user:last_assistant_summary"]) <= MAX_INLINE_PREVIOUS_TEXT_CHARS
