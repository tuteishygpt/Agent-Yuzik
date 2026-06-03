from __future__ import annotations

from dataclasses import dataclass


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
    if lowered == "audio/x-wav":
        return "audio/wav"
    if lowered == "audio/x-m4a":
        return "audio/aac"
    return lowered


def validate_gemini_chat_file(
    *,
    mime_type: str | None,
    size_bytes: int,
) -> FilePolicyResult:
    normalized = normalize_mime_type(mime_type)

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

    supported = (
        normalized in SUPPORTED_IMAGE_MIME_TYPES
        or normalized in SUPPORTED_AUDIO_MIME_TYPES
        or normalized in SUPPORTED_DOCUMENT_MIME_TYPES
        or normalized in SUPPORTED_TEXT_MIME_TYPES
    )
    if supported:
        return FilePolicyResult(supported=True)

    return FilePolicyResult(
        supported=False,
        error="unsupported_file",
        message=unsupported_file_reply(normalized),
        diagnostics={"unsupported_mime_type": normalized},
    )
