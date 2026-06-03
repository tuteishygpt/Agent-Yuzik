import pytest
from google.genai import types

from services.gemini_file_policy import validate_gemini_chat_file
from yuzik_workflow.policy import detect_language, evaluate_input_policy, text_from_content


def test_text_from_content_extracts_stripped_user_text():
    content = types.Content(role="user", parts=[types.Part(text="  Прывітанне  ")])

    assert text_from_content(content) == "Прывітанне"


@pytest.mark.parametrize(
    ("text", "language"),
    [
        ("Прывітанне, як справы?", "be"),
        ("Привет, как дела?", "ru"),
        ("Hello there", "en"),
    ],
)
def test_detect_language_for_supported_inputs(text, language):
    assert detect_language(text) == language


def test_evaluate_input_policy_sets_tts_image_cancel_and_time_flags():
    policy = evaluate_input_policy("Намалюй ката і прачытай уголас сёння")

    assert policy["image_requested"] is True
    assert policy["tts_requested"] is True
    assert policy["minsk_time_enabled"] is True
    assert policy["timezone"] == "Europe/Minsk"
    assert policy["creation_cancelled"] is False


def test_evaluate_input_policy_cancel_drops_creation_flags():
    policy = evaluate_input_policy("Не трэба, адмяні малюнак і агучку")

    assert policy["creation_cancelled"] is True
    assert policy["image_requested"] is False
    assert policy["tts_requested"] is False


def test_unsupported_file_policy_has_friendly_message():
    result = validate_gemini_chat_file(mime_type="application/x-msdownload", size_bytes=12)

    assert result.supported is False
    assert "не магу апрацаваць" in result.message
