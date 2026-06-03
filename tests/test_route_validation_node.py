from types import SimpleNamespace

from yuzik_workflow.validation import apply_route_validation


def test_route_validation_cancel_drops_creation_requests():
    state = {
        "temp:creation_cancelled": True,
        "temp:tts_requested": True,
        "temp:image_requested": True,
    }

    result = apply_route_validation(state)

    assert result == "cancel"
    assert state["temp:tts_requested"] is False
    assert state["temp:image_requested"] is False


def test_route_validation_file_error_short_circuits_to_fallback():
    state = {
        "temp:file_ok": False,
        "temp:file_error": "Файл не падтрымліваецца.",
    }

    result = apply_route_validation(state)

    assert result == "fallback"
    assert state["temp:primary_route"] == "fallback"
    assert state["temp:validation_errors"] == ["Файл не падтрымліваецца."]


def test_route_validation_marks_chat_default():
    state = {}

    assert apply_route_validation(state) == "chat"
    assert state["temp:primary_route"] == "chat"
