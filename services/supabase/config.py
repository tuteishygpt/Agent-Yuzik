from __future__ import annotations

import os
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Mapping
from urllib.parse import urlparse


_BUCKET_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,62}$")
_CALLBACK_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.-]*$")
_DISALLOWED_CALLBACK_SCHEMES = {"javascript", "data", "file"}


@dataclass(frozen=True)
class SupabaseSettings:
    url: str
    anon_key: str
    service_role_key: str
    jwt_issuer: str
    jwt_audience: str
    upload_bucket: str
    artifact_bucket: str
    web_callback_dev: str
    web_callback_prod: str
    mobile_callback_dev: str
    mobile_callback_prod: str


@dataclass(frozen=True)
class SupabaseJWTSettings:
    issuer: str
    audience: str


def _require(environ: Mapping[str, str], key: str) -> str:
    value = environ.get(key, "").strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value


def _validate_project_url(name: str, value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.params
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError(f"{name} must be a bare Supabase project URL")
    return value.rstrip("/")


def _validate_issuer_url(name: str, value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"{name} must be an absolute http(s) URL without query or fragment")
    return value


def _validate_callback_url(name: str, value: str) -> str:
    parsed = urlparse(value)
    scheme = parsed.scheme.lower()
    if (
        not scheme
        or not _CALLBACK_SCHEME_RE.match(scheme)
        or scheme in _DISALLOWED_CALLBACK_SCHEMES
        or parsed.params
        or parsed.fragment
        or (scheme in {"http", "https"} and not parsed.netloc)
        or (scheme not in {"http", "https"} and not parsed.netloc and not parsed.path)
    ):
        raise ValueError(f"{name} must be an absolute callback URL")
    return value


def _validate_bucket_name(name: str, value: str) -> str:
    if not _BUCKET_NAME_RE.match(value):
        raise ValueError(
            f"{name} must contain only lowercase letters, numbers, dots, dashes, or underscores"
        )
    return value


def load_supabase_settings(environ: Mapping[str, str] | None = None) -> SupabaseSettings:
    env = os.environ if environ is None else environ

    settings = SupabaseSettings(
        url=_validate_project_url("SUPABASE_URL", _require(env, "SUPABASE_URL")),
        anon_key=_require(env, "SUPABASE_ANON_KEY"),
        service_role_key=_require(env, "SUPABASE_SERVICE_ROLE_KEY"),
        jwt_issuer=_validate_issuer_url(
            "SUPABASE_JWT_ISSUER",
            _require(env, "SUPABASE_JWT_ISSUER"),
        ),
        jwt_audience=_require(env, "SUPABASE_JWT_AUDIENCE"),
        upload_bucket=_validate_bucket_name(
            "SUPABASE_UPLOAD_BUCKET",
            _require(env, "SUPABASE_UPLOAD_BUCKET"),
        ),
        artifact_bucket=_validate_bucket_name(
            "SUPABASE_ARTIFACT_BUCKET",
            _require(env, "SUPABASE_ARTIFACT_BUCKET"),
        ),
        web_callback_dev=_validate_callback_url(
            "SUPABASE_WEB_CALLBACK_DEV",
            _require(env, "SUPABASE_WEB_CALLBACK_DEV"),
        ),
        web_callback_prod=_validate_callback_url(
            "SUPABASE_WEB_CALLBACK_PROD",
            _require(env, "SUPABASE_WEB_CALLBACK_PROD"),
        ),
        mobile_callback_dev=_validate_callback_url(
            "SUPABASE_MOBILE_CALLBACK_DEV",
            _require(env, "SUPABASE_MOBILE_CALLBACK_DEV"),
        ),
        mobile_callback_prod=_validate_callback_url(
            "SUPABASE_MOBILE_CALLBACK_PROD",
            _require(env, "SUPABASE_MOBILE_CALLBACK_PROD"),
        ),
    )

    if settings.upload_bucket == settings.artifact_bucket:
        raise ValueError("SUPABASE_UPLOAD_BUCKET and SUPABASE_ARTIFACT_BUCKET must be different")

    return settings


def load_supabase_jwt_settings(environ: Mapping[str, str] | None = None) -> SupabaseJWTSettings:
    env = os.environ if environ is None else environ

    return SupabaseJWTSettings(
        issuer=_validate_issuer_url(
            "SUPABASE_JWT_ISSUER",
            _require(env, "SUPABASE_JWT_ISSUER"),
        ),
        audience=_require(env, "SUPABASE_JWT_AUDIENCE"),
    )


@lru_cache(maxsize=1)
def get_supabase_settings() -> SupabaseSettings:
    return load_supabase_settings()


@lru_cache(maxsize=1)
def get_supabase_jwt_settings() -> SupabaseJWTSettings:
    return load_supabase_jwt_settings()


def reset_supabase_settings_cache() -> None:
    get_supabase_settings.cache_clear()
    get_supabase_jwt_settings.cache_clear()
