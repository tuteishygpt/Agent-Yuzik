from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

PrimaryRoute = Literal[
    "chat",
    "search",
    "weather",
    "verbum",
    "datetime",
    "meme",
    "image",
    "file_qa",
    "cancel",
    "fallback",
]

PostAction = Literal["tts"]


@dataclass
class RoutePlan:
    primary_route: PrimaryRoute
    args: dict[str, Any] = field(default_factory=dict)
    post_actions: list[PostAction] = field(default_factory=list)
    direct_answer: str | None = None
    confidence: float | None = None


@dataclass
class ExecutionResult:
    text: str | None = None
    parts: list[Any] = field(default_factory=list)
    artifact_delta: dict[str, int] = field(default_factory=dict)
    error: str | None = None
    error_type: str | None = None


@dataclass
class YuzikWorkflowState:
    user_id: str
    channel: str
    conversation_id: str
    session_id: str
    text: str | None

    language: str = "be"
    timezone: str | None = None
    minsk_time_enabled: bool = False

    tts_requested: bool = False
    image_requested: bool = False
    creation_cancelled: bool = False

    file_ok: bool = True
    file_error: str | None = None
    file_diagnostics: dict[str, Any] = field(default_factory=dict)

    primary_route: PrimaryRoute | None = None
    post_actions: list[PostAction] = field(default_factory=list)
    route_args: dict[str, Any] = field(default_factory=dict)
    route_confidence: float | None = None
    validation_errors: list[str] = field(default_factory=list)

    primary_text: str | None = None
    primary_parts: list[Any] = field(default_factory=list)
    artifact_delta: dict[str, int] = field(default_factory=dict)

    artifacts_collected: bool = False
    audio_url: str | None = None
    image_url: str | None = None

    error: str | None = None
    error_type: str | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)
