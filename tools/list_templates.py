"""
Tool: вяртае спрошчаны спіс шаблонаў Memegen (ID + імя).
"""
from __future__ import annotations
import requests

def list_memegen_templates(limit: int = 200) -> dict[str, list[dict]]:
    """
    Па /templates/ атрыманым JSON фарміруе лёгкі спіс.
    Returns:
        {"status":"success", "templates":[{"id":"buzz","name":"X, X Everywhere"},…]}
    """
    resp = requests.get("https://api.memegen.link/templates/").json()[:limit]
    simplified = [{"id": t["id"], "name": t["name"]} for t in resp]
    return {"status": "success", "templates": simplified}

