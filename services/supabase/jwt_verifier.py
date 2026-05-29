from __future__ import annotations

from functools import lru_cache
from typing import Any

import jwt
import requests
from jwt import InvalidTokenError, PyJWKClient, PyJWKClientError

from services.supabase.config import get_supabase_jwt_settings


class SupabaseJWTVerificationError(ValueError):
    """Raised when a Supabase access token cannot be verified."""


class SupabaseJWTVerifier:
    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        jwks_url: str | None = None,
        algorithms: tuple[str, ...] = ("RS256", "ES256"),
    ) -> None:
        self.issuer = issuer.rstrip("/")
        self.audience = audience
        self.algorithms = algorithms
        self.jwks_url = jwks_url or self._discover_jwks_url()
        self._jwks_client = PyJWKClient(self.jwks_url)

    def _discover_jwks_url(self) -> str:
        default_jwks_url = f"{self.issuer}/.well-known/jwks.json"
        try:
            response = requests.get(
                f"{self.issuer}/.well-known/openid-configuration",
                timeout=5,
            )
            response.raise_for_status()
        except requests.RequestException:
            return default_jwks_url

        jwks_uri = response.json().get("jwks_uri")
        if not isinstance(jwks_uri, str) or not jwks_uri:
            return default_jwks_url
        return jwks_uri

    def verify(self, access_token: str) -> dict[str, Any]:
        if not access_token:
            raise SupabaseJWTVerificationError("Missing access token")

        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(access_token)
            claims = jwt.decode(
                access_token,
                signing_key.key,
                algorithms=list(self.algorithms),
                audience=self.audience,
                issuer=self.issuer,
            )
        except (InvalidTokenError, PyJWKClientError, requests.RequestException) as exc:
            raise SupabaseJWTVerificationError(str(exc)) from exc

        if not claims.get("sub"):
            raise SupabaseJWTVerificationError("Supabase token is missing sub")

        return claims


@lru_cache(maxsize=1)
def get_jwt_verifier() -> SupabaseJWTVerifier:
    settings = get_supabase_jwt_settings()
    return SupabaseJWTVerifier(
        issuer=settings.issuer,
        audience=settings.audience,
    )


def reset_jwt_verifier_cache() -> None:
    get_jwt_verifier.cache_clear()
