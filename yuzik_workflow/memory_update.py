from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from google.genai import types

from yuzik_workflow.postprocess import summarize_for_context, text_from_node_output

MAX_ROLLING_SUMMARY_CHARS = 6000
MAX_TOOL_RESULT_SUMMARY_CHARS = 1000

_SAFE_ARTIFACT_KEYS = {"id", "artifact_id", "filename", "mime_type", "url", "version"}


def _trim(value: str, limit: int) -> str:
    return value.strip()[:limit].rstrip()


def _state_text(state: Any, key: str) -> str | None:
    value = state.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _selected_route(ctx: Any, state: Any) -> str | None:
    route = _state_text(state, "temp:primary_route")
    if route:
        return route
    route = getattr(ctx, "route", None)
    return route.strip() if isinstance(route, str) and route.strip() else None


def _tool_result_summary(state: Any) -> str | None:
    summary = _state_text(state, "temp:tool_result_summary")
    if summary:
        return _trim(summary, MAX_TOOL_RESULT_SUMMARY_CHARS)
    diagnostics = state.get("temp:routing_diagnostics") or {}
    if isinstance(diagnostics, Mapping):
        value = diagnostics.get("tool_result_summary")
        if isinstance(value, str) and value.strip():
            return _trim(value, MAX_TOOL_RESULT_SUMMARY_CHARS)
    return None


def _update_previous_answer_state(state: Any, text: str) -> str:
    summary = summarize_for_context(text)
    state["user:last_assistant_summary"] = summary
    if summary == text:
        state["user:last_assistant_text"] = text
    else:
        state.pop("user:last_assistant_text", None)
    return summary


def _update_rolling_summary(state: Any, *, route: str | None, summary: str) -> None:
    previous = _state_text(state, "user:rolling_summary")
    entry = f"{route}: {summary}" if route else summary
    combined = f"{previous}\n{entry}" if previous else entry
    if len(combined) > MAX_ROLLING_SUMMARY_CHARS:
        combined = combined[-MAX_ROLLING_SUMMARY_CHARS:].lstrip()
    state["user:rolling_summary"] = combined


def _safe_artifact_refs(state: Any) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    raw_refs = state.get("temp:artifact_refs") or []
    if isinstance(raw_refs, list):
        for raw_ref in raw_refs:
            if not isinstance(raw_ref, Mapping):
                continue
            ref = {
                key: value
                for key, value in raw_ref.items()
                if key in _SAFE_ARTIFACT_KEYS and value is not None
            }
            if ref:
                refs.append(ref)

    artifact_delta = state.get("temp:artifact_delta") or {}
    if isinstance(artifact_delta, Mapping):
        for filename, version in artifact_delta.items():
            if isinstance(filename, str):
                refs.append({"filename": filename, "version": version})
    return refs


def _store_artifact_memory(state: Any) -> None:
    refs = _safe_artifact_refs(state)
    if not refs:
        return
    state["user:recent_artifacts"] = refs
    first = refs[0]
    artifact_id = first.get("id") or first.get("artifact_id") or first.get("filename")
    if isinstance(artifact_id, str) and artifact_id.strip():
        state["user:last_assistant_artifact_id"] = artifact_id.strip()


async def memory_update_node(ctx: Any, node_input: Any) -> Any:
    state = ctx.state
    route = _selected_route(ctx, state)
    if route:
        state["user:last_route"] = route

    tool_summary = _tool_result_summary(state)
    if tool_summary:
        state["user:last_tool_result_summary"] = tool_summary

    text = _state_text(state, "temp:primary_text") or text_from_node_output(node_input)
    if text:
        summary = _update_previous_answer_state(state, text)
        _update_rolling_summary(state, route=route, summary=summary)

    _store_artifact_memory(state)
    return node_input
