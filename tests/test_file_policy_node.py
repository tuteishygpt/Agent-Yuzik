import asyncio

from google.adk.events import Event
from google.genai import types

from yuzik_workflow.context import TurnContext
from yuzik_workflow.file_policy import file_policy_node


class FakeContext:
    def __init__(self, state=None):
        self.state = state or {}
        self.route = None


def make_turn(content, *, previous_text=None, previous_summary=None):
    return TurnContext(
        current_content=content,
        current_text="\n".join(
            part.text for part in (content.parts or []) if getattr(part, "text", None)
        ).strip()
        or None,
        previous_text=previous_text,
        previous_summary=previous_summary,
        previous_artifact_id="artifact-1",
        language="be",
    )


def test_valid_text_only_turn_passes_through_unchanged_and_stores_state():
    ctx = FakeContext()
    content = types.Content(role="user", parts=[types.Part(text="Hello")])
    turn = make_turn(
        content,
        previous_text="Previous answer",
        previous_summary="Previous summary",
    )

    result = asyncio.run(file_policy_node(ctx, turn))

    assert result is turn
    assert ctx.route is None
    assert ctx.state["temp:turn_current_text"] == "Hello"
    assert ctx.state["temp:turn_previous_text"] == "Previous answer"
    assert ctx.state["temp:turn_previous_summary"] == "Previous summary"
    assert ctx.state["temp:turn_previous_artifact_id"] == "artifact-1"
    assert ctx.state["temp:turn_language"] == "be"
    assert ctx.state["temp:file_ok"] is True


def test_unsupported_inline_file_sets_file_error_route_and_event():
    ctx = FakeContext()
    content = types.Content(
        role="user",
        parts=[
            types.Part(
                inline_data=types.Blob(
                    data=b"not allowed",
                    mime_type="application/x-msdownload",
                )
            )
        ],
    )
    turn = make_turn(content)

    result = asyncio.run(file_policy_node(ctx, turn))

    assert isinstance(result, Event)
    assert ctx.route == "file_error"
    assert ctx.state["temp:file_ok"] is False
    assert ctx.state["temp:file_error"]
    assert result.content.parts[0].text == ctx.state["temp:file_error"]


def test_file_policy_stores_turn_state_before_routing_file_errors():
    ctx = FakeContext()
    content = types.Content(
        role="user",
        parts=[
            types.Part(text="Please inspect this"),
            types.Part(
                inline_data=types.Blob(data=b"x", mime_type="application/x-msdownload")
            ),
        ],
    )
    turn = make_turn(content, previous_text="Previous answer")

    asyncio.run(file_policy_node(ctx, turn))

    assert ctx.state["temp:turn_current_text"] == "Please inspect this"
    assert ctx.state["temp:turn_previous_text"] == "Previous answer"
    assert "temp:turn_intent_route" not in ctx.state


def test_file_policy_stores_file_part_presence_for_classifier_context():
    ctx = FakeContext()
    content = types.Content(
        role="user",
        parts=[
            types.Part(text="Inspect this image"),
            types.Part(inline_data=types.Blob(data=b"png", mime_type="image/png")),
        ],
    )
    turn = make_turn(content)

    asyncio.run(file_policy_node(ctx, turn))

    assert ctx.state["temp:turn_has_file_parts"] is True
    assert ctx.state["temp:turn_file_part_count"] == 1
