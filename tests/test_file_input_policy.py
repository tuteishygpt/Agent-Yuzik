import pytest

from services.gemini_file_policy import (
    MAX_INLINE_VIDEO_BYTES,
    SUPPORTED_AUDIO_MIME_TYPES,
    SUPPORTED_DOCUMENT_MIME_TYPES,
    SUPPORTED_IMAGE_MIME_TYPES,
    SUPPORTED_TEXT_MIME_TYPES,
    SUPPORTED_VIDEO_MIME_TYPES,
    normalize_mime_type,
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
        ("audio/x-m4a", "audio/aac"),
        ("Text/Plain; charset=utf-8", "text/plain"),
        (None, None),
    ],
)
def test_file_policy_normalizes_common_input_mime_variants(raw_mime_type, normalized):
    assert normalize_mime_type(raw_mime_type) == normalized


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
