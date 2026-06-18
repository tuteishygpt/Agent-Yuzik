import asyncio

from google.genai import types


class FakeContext:
    def __init__(self, state=None):
        self.state = state or {}


class FakeMessageStore:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def list_message_rows(self, conversation_id):
        self.calls.append(conversation_id)
        return list(self.rows)


class FakeArtifactStore:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def list_recent_artifacts(self, *, user_id, conversation_id, limit):
        self.calls.append(
            {
                "user_id": user_id,
                "conversation_id": conversation_id,
                "limit": limit,
            }
        )
        return list(self.rows)


def test_build_context_pack_includes_current_and_previous_state():
    from yuzik_workflow.context_pack import build_context_pack

    content = types.Content(role="user", parts=[types.Part(text="  read it aloud  ")])
    ctx = FakeContext(
        {
            "user:last_assistant_text": "Previous answer",
            "user:last_assistant_summary": "Previous summary",
            "user:last_assistant_artifact_id": "artifact-prev",
            "user:rolling_summary": "Rolling summary",
            "temp:pending_action": {"kind": "tts", "target": "previous"},
            "temp:last_route": "chat",
            "temp:last_tool_result_summary": "Tool result",
        }
    )

    pack = build_context_pack(ctx, content)

    assert pack.current_content is content
    assert pack.current_text == "read it aloud"
    assert pack.language == "en"
    assert pack.previous_assistant_text == "Previous answer"
    assert pack.previous_assistant_summary == "Previous summary"
    assert pack.previous_artifact_id == "artifact-prev"
    assert pack.rolling_summary == "Rolling summary"
    assert pack.pending_action == {"kind": "tts", "target": "previous"}
    assert pack.last_route == "chat"
    assert pack.last_tool_result_summary == "Tool result"


def test_build_context_pack_loads_recent_messages_with_limit_and_truncation():
    from yuzik_workflow.context_pack import build_context_pack

    long_text = "x" * 2000
    rows = [
        {
            "role": "user",
            "content": f"message-{index}",
            "content_type": "text",
            "created_at": f"2026-06-19T00:00:0{index}Z",
        }
        for index in range(7)
    ]
    rows.append(
        {
            "role": "assistant",
            "content": long_text,
            "content_type": "text",
            "created_at": "2026-06-19T00:00:07Z",
        }
    )
    store = FakeMessageStore(rows)

    pack = build_context_pack(
        FakeContext(),
        "hello",
        conversation_id="conversation-1",
        chat_message_store=store,
        max_recent_messages=3,
    )

    assert store.calls == ["conversation-1"]
    assert [message.text for message in pack.recent_messages] == [
        "message-5",
        "message-6",
        "x" * 1200,
    ]
    assert pack.recent_messages[-1].role == "assistant"
    assert pack.recent_messages[-1].content_type == "text"


def test_build_context_pack_uses_artifact_refs_without_private_payloads():
    from yuzik_workflow.context_pack import build_context_pack

    artifact_store = FakeArtifactStore(
        [
            {
                "id": "artifact-1",
                "filename": "image.png",
                "mime_type": "image/png",
                "artifact_kind": "assistant_image",
                "size_bytes": 123,
                "created_at": "2026-06-19T00:00:00Z",
                "object_path": "user/private/path/image.png",
                "bucket": "assistant-artifacts",
                "data": b"png-bytes",
            },
            {
                "id": "artifact-2",
                "filename": "voice.wav",
                "mime_type": "audio/wav",
                "artifact_kind": "assistant_audio",
                "size_bytes": 456,
                "created_at": "2026-06-19T00:00:01Z",
                "object_path": "user/private/path/voice.wav",
                "bucket": "assistant-artifacts",
                "data": b"wav-bytes",
            },
        ]
    )

    pack = build_context_pack(
        FakeContext(),
        "draw from that",
        user_id="user-1",
        conversation_id="conversation-1",
        artifact_store=artifact_store,
        max_recent_artifacts=1,
    )

    assert artifact_store.calls == [
        {"user_id": "user-1", "conversation_id": "conversation-1", "limit": 1}
    ]
    assert len(pack.recent_artifacts) == 1
    assert pack.recent_artifacts[0].id == "artifact-2"
    assert pack.recent_artifacts[0].filename == "voice.wav"
    assert not hasattr(pack.recent_artifacts[0], "object_path")
    assert not hasattr(pack.recent_artifacts[0], "bucket")
    assert not hasattr(pack.recent_artifacts[0], "data")


def test_build_context_pack_is_usable_without_injected_stores():
    from yuzik_workflow.context_pack import ContextPack, build_context_pack

    pack = build_context_pack(FakeContext(), "hello")

    assert isinstance(pack, ContextPack)
    assert pack.current_text == "hello"
    assert pack.recent_messages == []
    assert pack.recent_artifacts == []


def test_conversation_context_node_stores_temp_state_and_returns_pack():
    from yuzik_workflow.context_pack import ContextPack, conversation_context_node

    ctx = FakeContext(
        {
            "user:last_assistant_text": "previous answer",
            "user:last_assistant_summary": "summary",
        }
    )

    pack = asyncio.run(conversation_context_node(ctx, "continue"))

    assert isinstance(pack, ContextPack)
    assert pack.current_text == "continue"
    assert ctx.state["temp:context_pack"] is pack
    assert ctx.state["temp:conversation_context_pack"] == {
        "current_text": "continue",
        "language": "en",
        "recent_messages": [],
        "rolling_summary": None,
        "previous_assistant_text": "previous answer",
        "previous_assistant_summary": "summary",
        "previous_artifact_id": None,
        "recent_artifacts": [],
        "pending_action": None,
        "last_route": None,
        "last_tool_result_summary": None,
    }
    assert "current_content" not in ctx.state["temp:conversation_context_pack"]
    assert ctx.state["temp:turn_current_text"] == "continue"
    assert ctx.state["temp:turn_previous_summary"] == "summary"
    assert ctx.state["temp:context_pack_diagnostics"] == {
        "recent_messages": 0,
        "recent_artifacts": 0,
        "has_rolling_summary": False,
        "has_pending_action": False,
    }


def test_conversation_context_node_accepts_turn_context_without_stringifying_it():
    from yuzik_workflow.context import TurnContext
    from yuzik_workflow.context_pack import conversation_context_node

    content = types.Content(role="user", parts=[types.Part(text="continue")])
    turn = TurnContext(
        current_content=content,
        current_text="continue",
        previous_text="previous answer",
        previous_summary="previous summary",
        previous_artifact_id="artifact-1",
        language="en",
    )
    ctx = FakeContext(
        {
            "temp:turn_current_text": "continue",
            "temp:turn_previous_text": "previous answer",
            "temp:turn_previous_summary": "previous summary",
            "temp:turn_previous_artifact_id": "artifact-1",
        }
    )

    pack = asyncio.run(conversation_context_node(ctx, turn))

    assert pack.current_content is content
    assert pack.current_text == "continue"
    assert "TurnContext(" not in ctx.state["temp:turn_current_text"]
    assert (
        ctx.state["temp:conversation_context_pack"]["current_text"]
        == "continue"
    )


def test_conversation_context_node_reads_user_external_context_pack():
    from yuzik_workflow.context_pack import conversation_context_node

    ctx = FakeContext(
        {
            "user:external_context_pack": {
                "recent_messages": [
                    {
                        "role": "assistant",
                        "text": "previous reply",
                        "content_type": "text",
                    }
                ],
                "recent_artifacts": [
                    {
                        "id": "artifact-1",
                        "filename": "image.png",
                        "mime_type": "image/png",
                        "artifact_kind": "assistant_image",
                    }
                ],
            }
        }
    )

    pack = asyncio.run(conversation_context_node(ctx, "draw based on that"))

    assert pack.recent_messages[0].text == "previous reply"
    assert pack.recent_artifacts[0].id == "artifact-1"
