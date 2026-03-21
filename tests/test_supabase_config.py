from __future__ import annotations

import importlib

import pytest


REQUIRED_SUPABASE_ENV = {
    "SUPABASE_URL": "https://project-ref.supabase.co",
    "SUPABASE_ANON_KEY": "anon-key",
    "SUPABASE_SERVICE_ROLE_KEY": "service-role-key",
    "SUPABASE_JWT_ISSUER": "https://project-ref.supabase.co/auth/v1",
    "SUPABASE_JWT_AUDIENCE": "authenticated",
    "SUPABASE_UPLOAD_BUCKET": "user-uploads",
    "SUPABASE_ARTIFACT_BUCKET": "assistant-artifacts",
    "SUPABASE_WEB_CALLBACK_DEV": "http://localhost:5173/auth/callback",
    "SUPABASE_WEB_CALLBACK_PROD": "https://app.example.com/auth/callback",
    "SUPABASE_MOBILE_CALLBACK_DEV": "yuzik-dev://auth/callback",
    "SUPABASE_MOBILE_CALLBACK_PROD": "yuzik://auth/callback",
}


def apply_env(monkeypatch: pytest.MonkeyPatch, **overrides: str) -> None:
    for key in REQUIRED_SUPABASE_ENV:
        monkeypatch.delenv(key, raising=False)

    values = dict(REQUIRED_SUPABASE_ENV)
    values.update(overrides)

    for key, value in values.items():
        monkeypatch.setenv(key, value)


def test_missing_required_setting_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_env(monkeypatch)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)

    config_module = importlib.import_module("services.supabase.config")

    with pytest.raises(ValueError, match="SUPABASE_SERVICE_ROLE_KEY"):
        config_module.load_supabase_settings()


def test_invalid_bucket_configuration_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_env(monkeypatch, SUPABASE_UPLOAD_BUCKET="bad/bucket")

    config_module = importlib.import_module("services.supabase.config")

    with pytest.raises(ValueError, match="SUPABASE_UPLOAD_BUCKET"):
        config_module.load_supabase_settings()


def test_duplicate_bucket_names_are_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_env(monkeypatch, SUPABASE_ARTIFACT_BUCKET=REQUIRED_SUPABASE_ENV["SUPABASE_UPLOAD_BUCKET"])

    config_module = importlib.import_module("services.supabase.config")

    with pytest.raises(ValueError, match="must be different"):
        config_module.load_supabase_settings()


def test_invalid_callback_configuration_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_env(monkeypatch, SUPABASE_MOBILE_CALLBACK_PROD="not a callback url")

    config_module = importlib.import_module("services.supabase.config")

    with pytest.raises(ValueError, match="SUPABASE_MOBILE_CALLBACK_PROD"):
        config_module.load_supabase_settings()


def test_callback_validation_rejects_dangerous_schemes(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_env(monkeypatch, SUPABASE_MOBILE_CALLBACK_PROD="javascript:alert(1)")

    config_module = importlib.import_module("services.supabase.config")

    with pytest.raises(ValueError, match="SUPABASE_MOBILE_CALLBACK_PROD"):
        config_module.load_supabase_settings()


def test_project_and_issuer_urls_reject_invalid_shapes(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_env(
        monkeypatch,
        SUPABASE_URL="https://project-ref.supabase.co/extra-path",
        SUPABASE_JWT_ISSUER="https://project-ref.supabase.co/auth/v1?broken=true",
    )

    config_module = importlib.import_module("services.supabase.config")

    with pytest.raises(ValueError, match="SUPABASE_URL|SUPABASE_JWT_ISSUER"):
        config_module.load_supabase_settings()


def test_explicit_empty_mapping_does_not_fall_back_to_process_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_env(monkeypatch)

    config_module = importlib.import_module("services.supabase.config")

    with pytest.raises(ValueError, match="SUPABASE_URL"):
        config_module.load_supabase_settings({})


def test_client_factories_use_expected_keys_and_non_persistent_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_env(monkeypatch)

    client_module = importlib.import_module("services.supabase.client")
    settings_module = importlib.import_module("services.supabase.config")
    settings = settings_module.load_supabase_settings()
    calls: list[tuple[str, str, object]] = []

    def fake_create_client(url: str, key: str, options: object) -> dict[str, object]:
        calls.append((url, key, options))
        return {"url": url, "key": key, "options": options}

    monkeypatch.setattr(client_module, "create_client", fake_create_client)

    anon_client = client_module.create_anon_client(settings)
    service_client = client_module.create_service_role_client(settings)

    assert anon_client["key"] == REQUIRED_SUPABASE_ENV["SUPABASE_ANON_KEY"]
    assert service_client["key"] == REQUIRED_SUPABASE_ENV["SUPABASE_SERVICE_ROLE_KEY"]
    assert calls[0][2].persist_session is False
    assert calls[0][2].auto_refresh_token is False
    assert calls[1][2].persist_session is False
    assert calls[1][2].auto_refresh_token is False


def test_client_getters_return_fresh_instances(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_env(monkeypatch)

    client_module = importlib.import_module("services.supabase.client")
    settings_module = importlib.import_module("services.supabase.config")
    settings = settings_module.load_supabase_settings()
    calls: list[tuple[str, str, object]] = []

    def fake_create_client(url: str, key: str, options: object) -> dict[str, object]:
        calls.append((url, key, options))
        return {"url": url, "key": key, "options": options, "call_index": len(calls)}

    monkeypatch.setattr(client_module, "create_client", fake_create_client)
    monkeypatch.setattr(client_module, "get_supabase_settings", lambda: settings)

    first = client_module.get_anon_client()
    second = client_module.get_anon_client()

    assert first is not second
    assert first["call_index"] == 1
    assert second["call_index"] == 2
