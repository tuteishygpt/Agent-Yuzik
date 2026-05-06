"""ADK tool that returns the current Minsk date and time."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types


MINSK_TIMEZONE = "Europe/Minsk"


def get_minsk_datetime(tool_context: Optional[ToolContext] = None) -> dict[str, str]:
    now = datetime.now(ZoneInfo(MINSK_TIMEZONE))

    if tool_context is not None:
        tool_context.state["user:timezone"] = MINSK_TIMEZONE
        tool_context.state["user:minsk_time_enabled"] = True

    return {
        "timezone": MINSK_TIMEZONE,
        "iso_datetime": now.isoformat(timespec="seconds"),
        "date": now.date().isoformat(),
        "time": now.strftime("%H:%M:%S"),
        "weekday": now.strftime("%A"),
        "utc_offset": now.strftime("%z"),
    }


class MinskDateTimeTool(FunctionTool):
    """ADK tool wrapper with a manual declaration compatible with Vertex AI."""

    def _get_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters=types.Schema(type=types.Type.OBJECT),
        )


minsk_datetime_tool = MinskDateTimeTool(get_minsk_datetime)

__all__ = ["get_minsk_datetime", "minsk_datetime_tool"]
