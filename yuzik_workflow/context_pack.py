from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from google.genai import types

from yuzik_workflow.context import (
    detect_language,
    previous_artifact_id_from_state,
    previous_summary_from_state,
    previous_text_from_state,
    text_from_content,
)


MAX_RECENT_MESSAGE_TEXT_CHARS = 1200
MAX_SUMMARY_CHARS = 3000
MAX_TOOL_RESULT_SUMMARY_CHARS = 1200

PendingAction = dict[str, Any]


@dataclass(frozen=True)
class ConversationMessage:
    role: str
    text: str
    content_type: str = "text"
    created_at: str | None = None


@dataclass(frozen=True)
class ArtifactRef:
    id: str
    filename: str | None
    mime_type: str | None
    artifact_kind: str | None
    size_bytes: int | None = None
    created_at: str | None = None


@dataclass(frozen=True)
class ContextPack:
    current_content: types.Content
    current_text: str | None
    language: str
    recent_messages: list[ConversationMessage]
    rolling_summary: str | None
    previous_assistant_text: str | None
    previous_assistant_summary: str | None
    previous_artifact_id: str | None
    recent_artifacts: list[ArtifactRef]
    pending_action: PendingAction | None
    last_route: str | None
    last_tool_result_summary: str | None


def _message_payload(message: ConversationMessage) -> dict[str, Any]:
    return {
        "role": message.role,
        "text": message.text,
        "content_type": message.content_type,
        "created_at": message.created_at,
    }


def _artifact_payload(artifact: ArtifactRef) -> dict[str, Any]:
    return {
        "id": artifact.id,
        "filename": artifact.filename,
        "mime_type": artifact.mime_type,
        "artifact_kind": artifact.artifact_kind,
        "size_bytes": artifact.size_bytes,
        "created_at": artifact.created_at,
    }


def context_pack_payload(pack: ContextPack) -> dict[str, Any]:
    return {
        "current_text": pack.current_text,
        "language": pack.language,
        "recent_messages": [
            _message_payload(message) for message in pack.recent_messages
        ],
        "rolling_summary": pack.rolling_summary,
        "previous_assistant_text": pack.previous_assistant_text,
        "previous_assistant_summary": pack.previous_assistant_summary,
        "previous_artifact_id": pack.previous_artifact_id,
        "recent_artifacts": [
            _artifact_payload(artifact) for artifact in pack.recent_artifacts
        ],
        "pending_action": pack.pending_action,
        "last_route": pack.last_route,
        "last_tool_result_summary": pack.last_tool_result_summary,
    }


def _content_from_input(current_content: Any) -> types.Content:
    if isinstance(current_content, types.Content):
        return current_content
    nested_content = getattr(current_content, "current_content", None)
    if isinstance(nested_content, types.Content):
        return nested_content
    return types.Content(role="user", parts=[types.Part(text=str(current_content))])


def _trim_text(value: Any, max_chars: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip()


def _state_text(state: dict[str, Any], *keys: str, max_chars: int) -> str | None:
    for key in keys:
        text = _trim_text(state.get(key), max_chars)
        if text is not None:
            return text
    return None


def _state_pending_action(state: dict[str, Any]) -> PendingAction | None:
    for key in (
        "temp:pending_action",
        "user:pending_action",
        "user:pending_text_action",
    ):
        value = state.get(key)
        if isinstance(value, dict):
            return dict(value)
    return None


def _coerce_payload_messages(value: Any) -> list[ConversationMessage]:
    if not isinstance(value, list):
        return []
    messages = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = _trim_text(item.get("text") or item.get("content"), MAX_RECENT_MESSAGE_TEXT_CHARS)
        role = item.get("role")
        if text is None or not isinstance(role, str) or not role.strip():
            continue
        content_type = item.get("content_type")
        created_at = item.get("created_at")
        messages.append(
            ConversationMessage(
                role=role.strip(),
                text=text,
                content_type=content_type if isinstance(content_type, str) else "text",
                created_at=created_at if isinstance(created_at, str) else None,
            )
        )
    return messages


def _coerce_payload_artifacts(value: Any) -> list[ArtifactRef]:
    if not isinstance(value, list):
        return []
    refs = []
    for item in value:
        if not isinstance(item, dict):
            continue
        artifact_id = item.get("id")
        if not isinstance(artifact_id, str) or not artifact_id.strip():
            continue
        refs.append(
            ArtifactRef(
                id=artifact_id.strip(),
                filename=item.get("filename") if isinstance(item.get("filename"), str) else None,
                mime_type=item.get("mime_type") if isinstance(item.get("mime_type"), str) else None,
                artifact_kind=item.get("artifact_kind") if isinstance(item.get("artifact_kind"), str) else None,
                size_bytes=item.get("size_bytes") if isinstance(item.get("size_bytes"), int) else None,
                created_at=item.get("created_at") if isinstance(item.get("created_at"), str) else None,
            )
        )
    return refs


def _coerce_message(row: Any) -> ConversationMessage | None:
    if not isinstance(row, dict):
        return None
    text = _trim_text(row.get("content"), MAX_RECENT_MESSAGE_TEXT_CHARS)
    role = row.get("role")
    if text is None or not isinstance(role, str) or not role.strip():
        return None
    content_type = row.get("content_type")
    created_at = row.get("created_at")
    return ConversationMessage(
        role=role.strip(),
        text=text,
        content_type=content_type if isinstance(content_type, str) else "text",
        created_at=created_at if isinstance(created_at, str) else None,
    )


def _load_recent_messages(
    chat_message_store: Any,
    conversation_id: str | None,
    max_recent_messages: int,
) -> list[ConversationMessage]:
    if chat_message_store is None or not conversation_id or max_recent_messages <= 0:
        return []

    if hasattr(chat_message_store, "list_message_rows"):
        rows = chat_message_store.list_message_rows(conversation_id)
    elif hasattr(chat_message_store, "list_messages"):
        rows = chat_message_store.list_messages(conversation_id)
    else:
        return []

    messages = [
        message
        for message in (_coerce_message(row) for row in rows or [])
        if message is not None
    ]
    return messages[-max_recent_messages:]


def _artifact_rows_from_metadata_backend(
    artifact_store: Any,
    *,
    user_id: str,
    conversation_id: str | None,
) -> list[dict[str, Any]]:
    backend = getattr(artifact_store, "metadata_backend", None)
    if backend is None or not hasattr(backend, "select"):
        return []
    filters: dict[str, Any] = {"user_id": user_id}
    if conversation_id is not None:
        filters["conversation_id"] = conversation_id
    return list(
        backend.select(
            "artifacts",
            filters=filters,
            order_by="created_at",
            ascending=True,
        )
        or []
    )


def _load_artifact_rows(
    artifact_store: Any,
    *,
    user_id: str | None,
    conversation_id: str | None,
    max_recent_artifacts: int,
) -> list[dict[str, Any]]:
    if artifact_store is None or not user_id or max_recent_artifacts <= 0:
        return []

    if hasattr(artifact_store, "list_recent_artifacts"):
        rows = artifact_store.list_recent_artifacts(
            user_id=user_id,
            conversation_id=conversation_id,
            limit=max_recent_artifacts,
        )
    else:
        rows = _artifact_rows_from_metadata_backend(
            artifact_store,
            user_id=user_id,
            conversation_id=conversation_id,
        )
    return [row for row in (rows or []) if isinstance(row, dict)][
        -max_recent_artifacts:
    ]


def _coerce_artifact_ref(row: dict[str, Any]) -> ArtifactRef | None:
    artifact_id = row.get("id")
    if not isinstance(artifact_id, str) or not artifact_id.strip():
        return None
    size_bytes = row.get("size_bytes")
    created_at = row.get("created_at")
    filename = row.get("filename")
    mime_type = row.get("mime_type")
    artifact_kind = row.get("artifact_kind")
    return ArtifactRef(
        id=artifact_id.strip(),
        filename=filename if isinstance(filename, str) else None,
        mime_type=mime_type if isinstance(mime_type, str) else None,
        artifact_kind=artifact_kind if isinstance(artifact_kind, str) else None,
        size_bytes=size_bytes if isinstance(size_bytes, int) else None,
        created_at=created_at if isinstance(created_at, str) else None,
    )


def _load_recent_artifacts(
    artifact_store: Any,
    *,
    user_id: str | None,
    conversation_id: str | None,
    max_recent_artifacts: int,
) -> list[ArtifactRef]:
    return [
        ref
        for ref in (
            _coerce_artifact_ref(row)
            for row in _load_artifact_rows(
                artifact_store,
                user_id=user_id,
                conversation_id=conversation_id,
                max_recent_artifacts=max_recent_artifacts,
            )
        )
        if ref is not None
    ]


def build_context_pack(
    ctx,
    current_content,
    *,
    user_id: str | None = None,
    conversation_id: str | None = None,
    chat_message_store: Any = None,
    artifact_store: Any = None,
    max_recent_messages: int = 6,
    max_recent_artifacts: int = 4,
) -> ContextPack:
    content = _content_from_input(current_content)
    current_text = text_from_content(content)
    state = getattr(ctx, "state", {}) or {}

    effective_user_id = user_id or _state_text(
        state,
        "user_id",
        "temp:user_id",
        max_chars=200,
    )
    effective_conversation_id = conversation_id or _state_text(
        state,
        "conversation_id",
        "temp:conversation_id",
        max_chars=200,
    )
    external_pack = state.get("user:external_context_pack") or state.get(
        "temp:external_context_pack"
    )
    external_pack = external_pack if isinstance(external_pack, dict) else {}
    external_messages = _coerce_payload_messages(external_pack.get("recent_messages"))
    external_artifacts = _coerce_payload_artifacts(external_pack.get("recent_artifacts"))

    return ContextPack(
        current_content=content,
        current_text=current_text,
        language=detect_language(current_text),
        recent_messages=external_messages[-max_recent_messages:]
        or _load_recent_messages(
            chat_message_store,
            effective_conversation_id,
            max_recent_messages,
        ),
        rolling_summary=_state_text(
            state,
            "user:rolling_summary",
            "temp:rolling_summary",
            max_chars=MAX_SUMMARY_CHARS,
        ),
        previous_assistant_text=previous_text_from_state(state),
        previous_assistant_summary=_trim_text(
            previous_summary_from_state(state),
            MAX_SUMMARY_CHARS,
        ),
        previous_artifact_id=previous_artifact_id_from_state(state),
        recent_artifacts=external_artifacts[-max_recent_artifacts:]
        or _load_recent_artifacts(
            artifact_store,
            user_id=effective_user_id,
            conversation_id=effective_conversation_id,
            max_recent_artifacts=max_recent_artifacts,
        ),
        pending_action=_state_pending_action(state),
        last_route=_state_text(
            state,
            "user:last_route",
            "temp:last_route",
            "temp:primary_route",
            max_chars=100,
        ),
        last_tool_result_summary=_state_text(
            state,
            "user:last_tool_result_summary",
            "temp:last_tool_result_summary",
            max_chars=MAX_TOOL_RESULT_SUMMARY_CHARS,
        ),
    )


async def conversation_context_node(ctx, node_input):
    pack = build_context_pack(ctx, node_input)
    ctx.state["temp:context_pack"] = pack
    ctx.state["temp:conversation_context_pack"] = context_pack_payload(pack)
    ctx.state["temp:turn_current_content"] = pack.current_content
    ctx.state["temp:turn_current_text"] = pack.current_text
    ctx.state["temp:turn_language"] = pack.language
    ctx.state["temp:turn_previous_text"] = pack.previous_assistant_text
    ctx.state["temp:turn_previous_summary"] = pack.previous_assistant_summary
    ctx.state["temp:turn_previous_artifact_id"] = pack.previous_artifact_id
    ctx.state["temp:context_pack_diagnostics"] = {
        "recent_messages": len(pack.recent_messages),
        "recent_artifacts": len(pack.recent_artifacts),
        "has_rolling_summary": pack.rolling_summary is not None,
        "has_pending_action": pack.pending_action is not None,
    }
    return pack
