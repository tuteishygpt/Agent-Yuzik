from __future__ import annotations

from typing import Any

from google.genai import types

from services.chat_service import ChatMedia


def media_kind(mime_type: str | None) -> str:
    if mime_type and mime_type.startswith("audio"):
        return "audio"
    if mime_type and mime_type.startswith("image"):
        return "image"
    return "file"


def media_from_parts(parts: list[types.Part]) -> list[ChatMedia]:
    media: list[ChatMedia] = []
    for index, part in enumerate(parts):
        inline_data = getattr(part, "inline_data", None)
        data = getattr(inline_data, "data", None)
        mime_type = getattr(inline_data, "mime_type", None)
        if not data or not mime_type:
            continue
        media.append(
            ChatMedia(
                kind=media_kind(mime_type),
                filename=f"part-{index}",
                mime_type=mime_type,
                data=data,
                url=None,
            )
        )
    return media


async def collect_artifacts(
    *,
    adk_service: Any,
    artifact_store: Any,
    adk_session_store: Any,
    user_id: str,
    session_id: str,
    conversation_id: str,
    artifact_delta: dict[str, int],
) -> list[ChatMedia]:
    collected: list[ChatMedia] = []
    for filename, version in artifact_delta.items():
        part = await adk_service.artifact_service.load_artifact(
            app_name=getattr(adk_service, "app_name", "app"),
            user_id=user_id,
            session_id=session_id,
            filename=filename,
            version=version,
        )
        inline_data = getattr(part, "inline_data", None)
        data = getattr(inline_data, "data", None)
        if not data:
            continue
        mime_type = getattr(inline_data, "mime_type", "") or "application/octet-stream"
        active_session = None
        if adk_session_store is not None:
            active_session = adk_session_store.get_active_session(
                user_id,
                getattr(adk_service, "app_name", "app"),
            )
        row = artifact_store.store_assistant_artifact(
            user_id=user_id,
            conversation_id=conversation_id,
            filename=filename,
            mime_type=mime_type,
            data=data,
            adk_session_row_id=active_session["id"] if active_session else None,
            metadata={"version": version, "session_id": session_id},
        )
        collected.append(
            ChatMedia(
                kind=media_kind(mime_type),
                filename=filename,
                mime_type=mime_type,
                data=data,
                url=artifact_store.get_download_url(row),
            )
        )
    return collected


async def postprocess_node(ctx, node_input):
    parts = getattr(node_input, "parts", None) or []
    text = "\n".join(part.text for part in parts if getattr(part, "text", None))
    if text:
        ctx.state["temp:primary_text"] = text
    if isinstance(node_input, types.Content):
        return node_input
    if text:
        return types.Content(role="model", parts=[types.Part(text=text)])
    return node_input
