import asyncio
import inspect

from google.genai import types

from services.gemini_file_policy import validate_gemini_chat_file
from yuzik_workflow.context import TurnContext, detect_language, text_from_content
from yuzik_workflow.policy import input_policy_node


class FakeContext:
    def __init__(self, state=None):
        self.state = state or {}
        self.route = None


def make_content(text):
    return types.Content(role="user", parts=[types.Part(text=text)])


def make_turn(content, previous_text=None, previous_summary=None):
    return TurnContext(
        current_content=content,
        current_text=text_from_content(content),
        previous_text=previous_text,
        previous_summary=previous_summary,
        previous_artifact_id=None,
        language="en",
    )


def test_text_from_content_extracts_stripped_user_text():
    content = make_content("  Hello  ")

    assert text_from_content(content) == "Hello"


def test_detect_language_for_supported_inputs():
    assert detect_language("Hello there") == "en"
    assert detect_language("Прывітанне, як справы?") == "be"
    assert detect_language("Привет, как дела?") == "ru"


def test_input_policy_compatibility_defaults_to_router_route():
    ctx = FakeContext()
    content = make_content("Draw an image based on it")
    turn = make_turn(content, previous_text="A small lighthouse on a cliff.")

    result = asyncio.run(input_policy_node(ctx, turn))

    assert ctx.route == "default"
    assert result is content
    assert ctx.state["temp:turn_previous_text"] == "A small lighthouse on a cliff."
    assert ctx.state["temp:tts_requested"] is False


def test_contextual_followup_keeps_previous_text_as_state_data():
    ctx = FakeContext()
    content = make_content("Read it aloud")
    previous_text = "The weather in Minsk is cloudy and 15C."

    result = asyncio.run(input_policy_node(ctx, make_turn(content, previous_text)))

    assert result is content
    assert text_from_content(result) == "Read it aloud"
    assert ctx.state["temp:turn_previous_text"] == previous_text


def test_previous_summary_is_preserved_as_state_data():
    ctx = FakeContext()
    content = make_content("Tell me more about this")

    asyncio.run(
        input_policy_node(
            ctx,
            make_turn(content, previous_summary="Summary of the previous assistant output."),
        )
    )

    assert (
        ctx.state["temp:turn_previous_summary"]
        == "Summary of the previous assistant output."
    )


def test_input_policy_has_no_previous_reference_regex():
    import yuzik_workflow.policy as policy

    source = inspect.getsource(policy)

    assert "PREVIOUS_REFERENCE_PATTERN" not in source
    assert "refers_to_previous_output" not in source


def test_unsupported_file_policy_has_friendly_message():
    result = validate_gemini_chat_file(mime_type="application/x-msdownload", size_bytes=12)

    assert result.supported is False
    assert result.message
