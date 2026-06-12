import asyncio
import inspect

from google.genai import types


class FakeContext:
    def __init__(self, state=None):
        self.state = state or {}


def test_turn_context_extracts_current_and_previous_text():
    from yuzik_workflow.context import turn_context_node

    ctx = FakeContext({"user:last_assistant_text": "previous answer"})
    content = types.Content(role="user", parts=[types.Part(text="  speak it  ")])

    turn = asyncio.run(turn_context_node(ctx, content))

    assert turn.current_content is content
    assert turn.current_text == "speak it"
    assert turn.previous_text == "previous answer"


def test_turn_context_missing_previous_text_is_none():
    from yuzik_workflow.context import turn_context_node

    content = types.Content(role="user", parts=[types.Part(text="hello")])

    turn = asyncio.run(turn_context_node(FakeContext(), content))

    assert turn.previous_text is None
    assert turn.previous_summary is None
    assert turn.previous_artifact_id is None


def test_turn_context_preserves_file_parts_in_current_content():
    from yuzik_workflow.context import turn_context_node

    file_part = types.Part(
        inline_data=types.Blob(data=b"file-bytes", mime_type="text/plain")
    )
    content = types.Content(
        role="user",
        parts=[types.Part(text="summarize this"), file_part],
    )

    turn = asyncio.run(turn_context_node(FakeContext(), content))

    assert turn.current_text == "summarize this"
    assert turn.current_content.parts[1] is file_part


def test_turn_context_does_not_contain_object_noun_allowlist():
    import yuzik_workflow.context as context

    source = inspect.getsource(context).lower()

    for noun in ("story", "joke", "forecast", "report", "poem"):
        assert noun not in source
