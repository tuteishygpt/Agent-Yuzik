from __future__ import annotations


def apply_route_validation(state) -> str:
    if state.get("temp:creation_cancelled"):
        state["temp:tts_requested"] = False
        state["temp:image_requested"] = False
        state["temp:primary_route"] = "cancel"
        return "cancel"

    if state.get("temp:file_ok") is False:
        message = state.get("temp:file_error") or "Файл не падтрымліваецца."
        state["temp:primary_route"] = "fallback"
        state["temp:validation_errors"] = [message]
        return "fallback"

    route = state.get("temp:primary_route") or "chat"
    state["temp:primary_route"] = route
    return route


async def route_validation_node(ctx, node_input):
    apply_route_validation(ctx.state)
    return node_input
