from __future__ import annotations

from supabase import Client, ClientOptions, create_client

from services.supabase.config import (
    SupabaseServiceRoleSettings,
    SupabaseSettings,
    get_supabase_settings,
    get_supabase_service_role_settings,
    reset_supabase_settings_cache,
)


def _build_client_options() -> ClientOptions:
    return ClientOptions(auto_refresh_token=False, persist_session=False)


def create_anon_client(settings: SupabaseSettings | None = None) -> Client:
    cfg = settings or get_supabase_settings()
    return create_client(cfg.url, cfg.anon_key, options=_build_client_options())


def create_service_role_client(
    settings: SupabaseSettings | SupabaseServiceRoleSettings | None = None,
) -> Client:
    cfg = settings or get_supabase_service_role_settings()
    return create_client(cfg.url, cfg.service_role_key, options=_build_client_options())


def get_anon_client() -> Client:
    return create_anon_client()


def get_service_role_client() -> Client:
    return create_service_role_client()


def reset_supabase_client_cache() -> None:
    reset_supabase_settings_cache()
