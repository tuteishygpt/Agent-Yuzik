from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from pathlib import Path


MAX_INLINE_VIDEO_BYTES = 20 * 1024 * 1024

SUPPORTED_IMAGE_MIME_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/heic",
    "image/heif",
}

SUPPORTED_AUDIO_MIME_TYPES = {
    "audio/wav",
    "audio/mp3",
    "audio/mpeg",
    "audio/aiff",
    "audio/aac",
    "audio/ogg",
    "audio/flac",
}

TRANSCODABLE_AUDIO_MIME_TYPES = {
    "audio/webm",
}

SUPPORTED_VIDEO_MIME_TYPES = {
    "video/mp4",
    "video/mpeg",
    "video/mov",
    "video/quicktime",
    "video/avi",
    "video/x-msvideo",
    "video/x-flv",
    "video/mpg",
    "video/webm",
    "video/wmv",
    "video/x-ms-wmv",
    "video/3gpp",
}

SUPPORTED_TEXT_MIME_TYPES = {
    "text/plain",
    "text/markdown",
    "text/html",
    "text/css",
    "text/csv",
    "text/xml",
    "application/json",
    "application/xml",
    "application/rtf",
    "application/x-javascript",
    "application/javascript",
    "application/x-python",
    "application/x-python-code",
}

SUPPORTED_DOCUMENT_MIME_TYPES = {
    "application/pdf",
}

FILENAME_MIME_TYPE_OVERRIDES = {
    ".aac": "audio/aac",
    ".csv": "text/csv",
    ".flv": "video/x-flv",
    ".js": "application/javascript",
    ".m4a": "audio/aac",
    ".mpga": "audio/mpeg",
    ".py": "application/x-python",
    ".rtf": "application/rtf",
    ".wave": "audio/wav",
}


@dataclass(frozen=True)
class FilePolicyResult:
    supported: bool
    error: str | None = None
    message: str | None = None
    diagnostics: dict | None = None


def unsupported_file_reply(mime_type: str | None) -> str:
    shown_type = mime_type or "unknown"
    return (
        f"На жаль, я не магу апрацаваць файл тыпу `{shown_type}`. "
        "Падтрымліваюцца выявы PNG/JPEG/WebP/HEIC/HEIF, аўдыё WAV/MP3/AIFF/AAC/OGG/FLAC, "
        "відэа MP4/MPEG/MOV/AVI/FLV/MPG/WebM/WMV/3GPP да 20 MB, PDF і тэкставыя файлы."
    )


def oversized_video_reply(size_bytes: int, max_bytes: int = MAX_INLINE_VIDEO_BYTES) -> str:
    return (
        f"Відэа занадта вялікае для chat-рэжыму: {size_bytes / (1024 * 1024):.1f} MB. "
        f"Калі ласка, дашліце відэа да {max_bytes // (1024 * 1024)} MB."
    )


def normalize_mime_type(mime_type: str | None) -> str | None:
    if not mime_type:
        return None
    lowered = mime_type.split(";", 1)[0].strip().lower()
    aliases = {
        "application/markdown": "text/markdown",
        "application/ogg": "audio/ogg",
        "application/x-rtf": "application/rtf",
        "audio/mp4": "audio/aac",
        "audio/vnd.dlna.adts": "audio/aac",
        "audio/vnd.wave": "audio/wav",
        "audio/wave": "audio/wav",
        "audio/x-aiff": "audio/aiff",
        "audio/x-flac": "audio/flac",
        "audio/x-m4a": "audio/aac",
        "audio/x-wav": "audio/wav",
        "image/jpg": "image/jpeg",
        "image/pjpeg": "image/jpeg",
        "image/x-png": "image/png",
        "text/javascript": "application/javascript",
        "text/rtf": "application/rtf",
        "text/x-markdown": "text/markdown",
        "text/x-python": "application/x-python",
        "video/flv": "video/x-flv",
        "video/msvideo": "video/avi",
        "video/x-m4v": "video/mp4",
        "video/x-mpeg": "video/mpeg",
    }
    return aliases.get(lowered, lowered)


def is_supported_mime_type(mime_type: str | None) -> bool:
    normalized = normalize_mime_type(mime_type)
    return (
        normalized in SUPPORTED_IMAGE_MIME_TYPES
        or normalized in SUPPORTED_AUDIO_MIME_TYPES
        or normalized in TRANSCODABLE_AUDIO_MIME_TYPES
        or normalized in SUPPORTED_VIDEO_MIME_TYPES
        or normalized in SUPPORTED_DOCUMENT_MIME_TYPES
        or normalized in SUPPORTED_TEXT_MIME_TYPES
    )


def guess_mime_type_from_filename(filename: str | None) -> str | None:
    if not filename:
        return None
    suffix = Path(filename).suffix.lower()
    if suffix in FILENAME_MIME_TYPE_OVERRIDES:
        return FILENAME_MIME_TYPE_OVERRIDES[suffix]
    guessed, _ = mimetypes.guess_type(filename)
    return normalize_mime_type(guessed)


def resolve_mime_type(mime_type: str | None, *, filename: str | None = None) -> str | None:
    normalized = normalize_mime_type(mime_type)
    if is_supported_mime_type(normalized):
        return normalized

    guessed = guess_mime_type_from_filename(filename)
    if is_supported_mime_type(guessed):
        return guessed

    return normalized


def validate_gemini_chat_file(
    *,
    mime_type: str | None,
    filename: str | None = None,
    size_bytes: int,
) -> FilePolicyResult:
    normalized = resolve_mime_type(mime_type, filename=filename)

    if normalized in SUPPORTED_VIDEO_MIME_TYPES:
        if size_bytes > MAX_INLINE_VIDEO_BYTES:
            return FilePolicyResult(
                supported=False,
                error="video_too_large",
                message=oversized_video_reply(size_bytes),
                diagnostics={
                    "mime_type": normalized,
                    "size_bytes": size_bytes,
                    "max_inline_video_bytes": MAX_INLINE_VIDEO_BYTES,
                },
            )
        return FilePolicyResult(supported=True)

    if is_supported_mime_type(normalized):
        return FilePolicyResult(supported=True)

    return FilePolicyResult(
        supported=False,
        error="unsupported_file",
        message=unsupported_file_reply(normalized),
        diagnostics={"unsupported_mime_type": normalized},
    )
