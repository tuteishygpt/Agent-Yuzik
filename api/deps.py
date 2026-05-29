from __future__ import annotations

import logging
import mimetypes
import os
from pathlib import Path

import config
from google import genai
from services.adk_service import ADKService
from services.supabase.adk_session_store import ADKSessionStore
from services.supabase.artifact_store import ArtifactStore
from services.supabase.chat_message_store import ChatMessageStore
from services.supabase.conversation_store import ConversationStore

log = logging.getLogger("app")

FILES_DIR = Path("files").resolve()
FILES_DIR.mkdir(exist_ok=True)

# Compatibility cache for older tests that seed history directly.
# Canonical reads and writes go through the store objects below.
chat_histories: dict[str, list[dict]] = {}

conversation_store = ConversationStore()
chat_message_store = ChatMessageStore()
adk_session_store = ADKSessionStore()
artifact_store = ArtifactStore()

adk_service: ADKService | None = None
try:
    adk_service = ADKService(session_store=adk_session_store)
    log.info("ADKService instance created successfully.")
except Exception as exc:
    log.error("Critical error: unable to initialize ADKService: %s", exc)


_genai_client = None


def append_to_history(user_id: str, entry: dict) -> None:
    """Compatibility helper for legacy callers."""
    chat_histories.setdefault(user_id, []).append(entry)


def get_genai_client():
    global _genai_client
    if _genai_client:
        return _genai_client

    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "global")

    if creds_path and project:
        log.info(
            "Initializing Vertex AI Gemini client | project=%s | location=%s | creds=%s",
            project, location, creds_path,
        )
        _genai_client = genai.Client(vertexai=True, project=project, location=location)
    else:
        _genai_client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _genai_client


def guess_mime(p: Path) -> str:
    mime, _ = mimetypes.guess_type(str(p))
    if mime:
        return mime
    lower = p.suffix.lower()
    if lower == ".pdf":
        return "application/pdf"
    if lower in {".txt", ".md"}:
        return "text/plain"
    return "application/octet-stream"


async def collect_artifacts(
    adk_service: ADKService,
    user_id: str,
    session_id: str,
    conversation_id: str | None,
    delta: dict,
    response: dict,
) -> None:
    for filename, version in delta.items():
        try:
            part = await adk_service.artifact_service.load_artifact(
                app_name=getattr(adk_service, "app_name", "app"),
                user_id=user_id,
                session_id=session_id,
                filename=filename,
                version=version,
            )
            if (
                part
                and getattr(part, "inline_data", None)
                and getattr(part.inline_data, "data", None)
            ):
                mime_type = getattr(part.inline_data, "mime_type", "")
                active_session = adk_session_store.get_active_session(
                    user_id,
                    getattr(adk_service, "app_name", "app"),
                )
                artifact_row = artifact_store.store_assistant_artifact(
                    user_id=user_id,
                    conversation_id=conversation_id,
                    filename=filename,
                    mime_type=mime_type or "application/octet-stream",
                    data=part.inline_data.data,
                    adk_session_row_id=active_session["id"] if active_session else None,
                    metadata={"version": version, "session_id": session_id},
                )
                artifact_url = artifact_store.get_download_url(artifact_row)
                if mime_type.startswith("audio"):
                    response["audio"] = artifact_url
                elif mime_type.startswith("image"):
                    response["image"] = artifact_url
        except Exception as exc:
            log.error("Error loading artifact %s: %s", filename, exc)
