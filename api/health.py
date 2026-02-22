# api/health.py
"""
Health-check endpoint для маніторынгу і deployment.
"""

from __future__ import annotations

from fastapi import APIRouter

from api.deps import adk_service

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
async def health_check():
    """
    Вяртае стан сервера.
    Карысна для Docker healthcheck, HF Spaces, маніторынгу і г.д.
    """
    return {
        "status": "ok",
        "adk_service": adk_service is not None,
    }
