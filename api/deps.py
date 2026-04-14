# api/deps.py
"""
Агульныя залежнасці, утыліты і стан, якія выкарыстоўваюцца ва ўсіх API-модулях.
"""

from __future__ import annotations

import logging
import mimetypes
from pathlib import Path
from typing import Dict, List

import config
from services.adk_service import ADKService

log = logging.getLogger("app")

# ---------------------------------------------------------------------
# Агульны стан прыкладання
# ---------------------------------------------------------------------

FILES_DIR = Path("files").resolve()
FILES_DIR.mkdir(exist_ok=True)

# ADK Service (адзіны экзэмпляр)
adk_service: ADKService | None = None
try:
    adk_service = ADKService()
    log.info("Экзэмпляр ADKService паспяхова створаны.")
except Exception as e:
    log.error("КРЫТЫЧНАЯ ПАМЫЛКА: Не атрымалася ініцыялізаваць ADKService: %s", e)

# Гісторыя чатаў у памяці (per user)
MAX_HISTORY_PER_USER = 200
chat_histories: Dict[str, List[Dict]] = {}


def append_to_history(user_id: str, entry: Dict) -> None:
    """Дадае запіс у гісторыю з аўтаматычнай абрэзкай да MAX_HISTORY_PER_USER."""
    if user_id not in chat_histories:
        chat_histories[user_id] = []
    chat_histories[user_id].append(entry)
    # Абразаем старыя паведамленні, калі перавышаны ліміт
    if len(chat_histories[user_id]) > MAX_HISTORY_PER_USER:
        chat_histories[user_id] = chat_histories[user_id][-MAX_HISTORY_PER_USER:]

# Global Gen AI Client (Lazy init)
_genai_client = None


def get_genai_client():
    global _genai_client
    if not _genai_client:
        _genai_client = config.create_genai_client()
    return _genai_client


# ---------------------------------------------------------------------
# Утыліты
# ---------------------------------------------------------------------

def guess_mime(p: Path) -> str:
    """Вызначае MIME-тып файла па яго пашырэнні."""
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
    delta: Dict,
    response: Dict,
) -> None:
    """
    Агульная функцыя для загрузкі артэфактаў (аўдыя/выявы) з ADK
    і запісу іх на дыск і ў response dict.
    
    Выкарыстоўваецца ў chat endpoint для пазбягання дублявання кода.
    """
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
                artifact_path = FILES_DIR / filename
                with open(artifact_path, "wb") as f:
                    f.write(part.inline_data.data)

                mime_type = getattr(part.inline_data, "mime_type", "")
                if mime_type.startswith("audio"):
                    response["audio"] = f"/api/files/{filename}"
                elif mime_type.startswith("image"):
                    response["image"] = f"/api/files/{filename}"
        except Exception as e:
            log.error(f"Error loading artifact {filename}: {e}")
