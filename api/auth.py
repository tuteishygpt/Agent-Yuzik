from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Header, HTTPException, status
from jwt import PyJWKClientError

from services.supabase.jwt_verifier import (
    SupabaseJWTVerificationError,
    get_jwt_verifier,
)


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str
    access_token: str
    claims: dict[str, Any]


class WebSocketAuthenticationError(Exception):
    def __init__(self, message: str, close_code: int = 4401) -> None:
        super().__init__(message)
        self.message = message
        self.close_code = close_code


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise _unauthorized("Missing bearer token")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized("Missing bearer token")
    return token.strip()


def authenticate_access_token(access_token: str) -> AuthenticatedUser:
    try:
        claims = get_jwt_verifier().verify(access_token)
    except (SupabaseJWTVerificationError, PyJWKClientError) as exc:
        raise _unauthorized(str(exc)) from exc

    return AuthenticatedUser(
        user_id=claims["sub"],
        access_token=access_token,
        claims=claims,
    )


async def get_current_user(authorization: str | None = Header(default=None)) -> AuthenticatedUser:
    return authenticate_access_token(extract_bearer_token(authorization))


def authenticate_websocket_message(message: dict[str, Any]) -> AuthenticatedUser:
    if message.get("type") != "auth":
        raise WebSocketAuthenticationError("authentication required before voice messages")

    access_token = message.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise WebSocketAuthenticationError("authentication required before voice messages")

    try:
        return authenticate_access_token(access_token.strip())
    except HTTPException as exc:
        raise WebSocketAuthenticationError(str(exc.detail)) from exc
