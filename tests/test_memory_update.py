import asyncio

from google.genai import types

from yuzik_workflow.memory_update import (
    MAX_ROLLING_SUMMARY_CHARS,
    MAX_TOOL_RESULT_SUMMARY_CHARS,
    memory_update_node,
)


class FakeContext:
    def __init__(self, state=None):
        self.state = state or {}
        self.route = None


def test_memory_update_stores_route_tool_summary_and_latest_answer():
    state = {
        "temp:primary_route": "dictionary",
        "temp:tool_result_summary": "Dictionary result",
    }
    ctx = FakeContext(state)
    content = types.Content(role="model", parts=[types.Part(text="Final answer")])

    result = asyncio.run(memory_update_node(ctx, content))

    assert result is content
    assert state["user:last_route"] == "dictionary"
    assert state["user:last_tool_result_summary"] == "Dictionary result"
    assert state["user:last_assistant_text"] == "Final answer"
    assert state["user:last_assistant_summary"] == "Final answer"
    assert state["user:rolling_summary"].endswith("dictionary: Final answer")


def test_memory_update_truncates_rolling_and_tool_summaries():
    state = {
        "user:rolling_summary": "old " * 3000,
        "temp:primary_route": "search",
        "temp:tool_result_summary": "t" * (MAX_TOOL_RESULT_SUMMARY_CHARS + 20),
    }
    ctx = FakeContext(state)
    answer = "Latest answer " + ("x" * 120)

    asyncio.run(memory_update_node(ctx, answer))

    assert len(state["user:rolling_summary"]) <= MAX_ROLLING_SUMMARY_CHARS
    assert state["user:rolling_summary"].endswith(f"search: {answer}")
    assert len(state["user:last_tool_result_summary"]) == MAX_TOOL_RESULT_SUMMARY_CHARS


def test_memory_update_stores_safe_artifact_references_without_bytes():
    state = {
        "temp:artifact_refs": [
            {
                "id": "artifact-1",
                "filename": "image.png",
                "mime_type": "image/png",
                "data": b"raw-bytes",
                "inline_data": {"data": b"more-bytes"},
            }
        ],
        "temp:artifact_delta": {"tts_output.wav": 0},
    }
    ctx = FakeContext(state)

    asyncio.run(memory_update_node(ctx, "Here is the image."))

    assert state["user:last_assistant_artifact_id"] == "artifact-1"
    assert state["user:recent_artifacts"] == [
        {"id": "artifact-1", "filename": "image.png", "mime_type": "image/png"},
        {"filename": "tts_output.wav", "version": 0},
    ]
    assert "raw-bytes" not in repr(state["user:recent_artifacts"])
