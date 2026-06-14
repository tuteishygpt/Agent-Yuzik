import pytest

from services.gemini_file_policy import (
    MAX_INLINE_VIDEO_BYTES,
    SUPPORTED_AUDIO_MIME_TYPES,
    SUPPORTED_DOCUMENT_MIME_TYPES,
    SUPPORTED_IMAGE_MIME_TYPES,
    SUPPORTED_TEXT_MIME_TYPES,
    SUPPORTED_VIDEO_MIME_TYPES,
    normalize_mime_type,
    resolve_mime_type,
    validate_gemini_chat_file,
)


@pytest.mark.parametrize(
    "mime_type",
    sorted(
        SUPPORTED_IMAGE_MIME_TYPES
        | SUPPORTED_AUDIO_MIME_TYPES
        | SUPPORTED_DOCUMENT_MIME_TYPES
        | SUPPORTED_TEXT_MIME_TYPES
    ),
)
def test_non_video_supported_file_types_are_accepted(mime_type):
    result = validate_gemini_chat_file(mime_type=mime_type, size_bytes=1)

    assert result.supported is True
    assert result.error is None


@pytest.mark.parametrize("mime_type", sorted(SUPPORTED_VIDEO_MIME_TYPES))
def test_supported_video_types_are_accepted_at_inline_size_limit(mime_type):
    result = validate_gemini_chat_file(
        mime_type=mime_type,
        size_bytes=MAX_INLINE_VIDEO_BYTES,
    )

    assert result.supported is True
    assert result.error is None


@pytest.mark.parametrize("mime_type", sorted(SUPPORTED_VIDEO_MIME_TYPES))
def test_supported_video_types_reject_oversized_inline_uploads(mime_type):
    result = validate_gemini_chat_file(
        mime_type=mime_type,
        size_bytes=MAX_INLINE_VIDEO_BYTES + 1,
    )

    assert result.supported is False
    assert result.error == "video_too_large"
    assert result.diagnostics == {
        "mime_type": mime_type,
        "size_bytes": MAX_INLINE_VIDEO_BYTES + 1,
        "max_inline_video_bytes": MAX_INLINE_VIDEO_BYTES,
    }


@pytest.mark.parametrize(
    ("raw_mime_type", "normalized"),
    [
        (" AUDIO/X-WAV ; charset=binary", "audio/wav"),
        ("audio/wave", "audio/wav"),
        ("audio/vnd.wave", "audio/wav"),
        ("audio/x-aiff", "audio/aiff"),
        ("audio/x-flac", "audio/flac"),
        ("audio/mp4", "audio/aac"),
        ("audio/vnd.dlna.adts", "audio/aac"),
        ("application/ogg", "audio/ogg"),
        ("audio/x-m4a", "audio/aac"),
        ("image/jpg", "image/jpeg"),
        ("image/pjpeg", "image/jpeg"),
        ("image/x-png", "image/png"),
        ("video/x-m4v", "video/mp4"),
        ("video/x-mpeg", "video/mpeg"),
        ("video/flv", "video/x-flv"),
        ("video/msvideo", "video/avi"),
        ("text/javascript", "application/javascript"),
        ("text/x-python", "application/x-python"),
        ("text/x-markdown", "text/markdown"),
        ("application/markdown", "text/markdown"),
        ("application/x-rtf", "application/rtf"),
        ("text/rtf", "application/rtf"),
        ("Text/Plain; charset=utf-8", "text/plain"),
        (None, None),
    ],
)
def test_file_policy_normalizes_common_input_mime_variants(raw_mime_type, normalized):
    assert normalize_mime_type(raw_mime_type) == normalized


@pytest.mark.parametrize(
    ("filename", "resolved"),
    [
        ("photo.png", "image/png"),
        ("photo.jpg", "image/jpeg"),
        ("photo.jpeg", "image/jpeg"),
        ("photo.webp", "image/webp"),
        ("photo.heic", "image/heic"),
        ("photo.heif", "image/heif"),
        ("voice.wav", "audio/wav"),
        ("voice.wave", "audio/wav"),
        ("song.mp3", "audio/mpeg"),
        ("song.aiff", "audio/aiff"),
        ("song.aif", "audio/aiff"),
        ("song.aac", "audio/aac"),
        ("song.m4a", "audio/aac"),
        ("song.ogg", "audio/ogg"),
        ("song.flac", "audio/flac"),
        ("clip.mp4", "video/mp4"),
        ("clip.mpeg", "video/mpeg"),
        ("clip.mpg", "video/mpeg"),
        ("clip.mov", "video/quicktime"),
        ("clip.avi", "video/avi"),
        ("clip.flv", "video/x-flv"),
        ("clip.webm", "video/webm"),
        ("clip.wmv", "video/x-ms-wmv"),
        ("clip.3gp", "video/3gpp"),
        ("document.pdf", "application/pdf"),
        ("notes.txt", "text/plain"),
        ("notes.md", "text/markdown"),
        ("table.csv", "text/csv"),
        ("data.json", "application/json"),
        ("data.xml", "text/xml"),
        ("page.html", "text/html"),
        ("style.css", "text/css"),
        ("script.js", "application/javascript"),
        ("script.py", "application/x-python"),
        ("rich.rtf", "application/rtf"),
    ],
)
def test_file_policy_resolves_supported_telegram_filenames_when_mime_is_unhelpful(
    filename,
    resolved,
):
    assert resolve_mime_type("application/octet-stream", filename=filename) == resolved

    result = validate_gemini_chat_file(
        mime_type="application/octet-stream",
        filename=filename,
        size_bytes=1,
    )

    assert result.supported is True
    assert result.error is None


def test_file_policy_prefers_supported_mime_type_over_conflicting_filename():
    assert resolve_mime_type("image/png", filename="not-really.csv") == "image/png"


def test_file_policy_rejects_unknown_or_missing_mime_type():
    unknown = validate_gemini_chat_file(
        mime_type="application/x-msdownload",
        size_bytes=1,
    )
    missing = validate_gemini_chat_file(mime_type=None, size_bytes=1)

    assert unknown.supported is False
    assert unknown.error == "unsupported_file"
    assert unknown.diagnostics == {"unsupported_mime_type": "application/x-msdownload"}
    assert missing.supported is False
    assert missing.error == "unsupported_file"
    assert missing.diagnostics == {"unsupported_mime_type": None}
