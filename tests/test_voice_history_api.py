from __future__ import annotations

import asyncio

from api.auth import AuthenticatedUser
from api import voice_history as voice_history_module
from services.supabase.backend import InMemorySupabaseBackend
from services.supabase.voice_turn_store import VoiceTurnStore


def _current_user(user_id: str = "voice-user") -> AuthenticatedUser:
    return AuthenticatedUser(user_id=user_id, access_token="token", claims={"sub": user_id})


def test_voice_turn_store_survives_restart_for_authenticated_user() -> None:
    backend = InMemorySupabaseBackend()
    first_store = VoiceTurnStore(backend)
    first_store.append_turn(
        user_id="voice-user",
        user_text="Dobry den",
        assistant_text="Vyadatna",
        timestamp=1.5,
    )
    first_store.append_turn(
        user_id="other-user",
        user_text="hide",
        assistant_text="hidden",
        timestamp=2.5,
    )

    reloaded_store = VoiceTurnStore(backend)
    turns = reloaded_store.list_turns("voice-user")
    rows = reloaded_store.list_turn_rows("voice-user")

    assert len(turns) == 1
    assert turns[0].user_text == "Dobry den"
    assert turns[0].assistant_text == "Vyadatna"
    assert turns[0].timestamp == 1.5
    assert rows[0]["user_text"] == "Dobry den"
    assert rows[0]["assistant_text"] == "Vyadatna"
    assert rows[0]["timestamp"] == 1.5


def test_voice_history_api_returns_only_authenticated_users_rows(monkeypatch) -> None:
    backend = InMemorySupabaseBackend()
    store = VoiceTurnStore(backend)
    store.append_turn(user_id="voice-user", user_text="hello", assistant_text="reply")
    store.append_turn(user_id="other-user", user_text="secret", assistant_text="hide")

    monkeypatch.setattr(voice_history_module, "voice_turn_store", store, raising=False)

    response = asyncio.run(
        voice_history_module.api_get_voice_history(
            user_id="other-user",
            current_user=_current_user(),
        )
    )

    assert response["user_id"] == "voice-user"
    assert response["turn_count"] == 1
    assert response["history"][0]["user_text"] == "hello"
    assert response["history"][0]["assistant_text"] == "reply"
    assert response["history"][0]["timestamp"] is not None
    assert len(response["history"]) == 1


def test_voice_history_api_clear_removes_only_authenticated_users_rows(monkeypatch) -> None:
    backend = InMemorySupabaseBackend()
    store = VoiceTurnStore(backend)
    store.append_turn(user_id="voice-user", user_text="hello", assistant_text="reply")
    store.append_turn(user_id="other-user", user_text="secret", assistant_text="hide")

    monkeypatch.setattr(voice_history_module, "voice_turn_store", store, raising=False)

    response = asyncio.run(
        voice_history_module.api_clear_voice_history(
            user_id="other-user",
            current_user=_current_user(),
        )
    )

    assert response == {"status": "ok", "user_id": "voice-user"}
    assert store.list_turns("voice-user") == []
    assert len(store.list_turns("other-user")) == 1
