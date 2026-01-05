from __future__ import annotations

"""
tools/meme_generator.py
~~~~~~~~~~~~~~~~~~~~~~~
Generates memes via Memegen API and stores the resulting image as an artifact
(returning an empty dict on success to prevent the agent from replying with text).
"""

import re
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union
from urllib.parse import quote

import aiohttp  # asynchronous HTTP client
from google.genai.types import Part

__all__ = [
    "generate_meme",          # synchronous – returns only URL/local path
    "generate_meme_and_save",  # async – returns an empty dict and saves an artifact
]

# ---------------------------------------------------------------------------
#   Escape helpers (Memegen rules)
# ---------------------------------------------------------------------------

_REPL: dict[str, str] = {
    "-": "--",      # hyphen – double to make it literal
    "_": "__",      # underscore – double to make it literal
    "?": "~q",
    "#": "~h",
    "%": "~p",
    "\\": "~b",
    '"': "''",
    "\n": "~n",
}


def _esc(text: str) -> str:
    """Escapes caption text using Memegen rules and percent‑encodes it."""
    for bad, good in _REPL.items():
        text = text.replace(bad, good)
    return quote(text, safe="~")  # keep ~q, ~h … intact


def _clean_id(tid: str) -> str:
    """Normalises a template ID into a URL‑friendly slug."""
    slug = (
        tid.strip()
        .lower()
        .replace(" ", "-")
        .replace("'", "")
        .replace('"', "")
    )
    return quote(slug, safe="-_")


def _prepare_lines(*items: Union[str, List[str], Tuple[str, ...]]) -> List[str]:
    """Converts any mix of arguments into a list of caption strings."""
    if len(items) == 1 and isinstance(items[0], (list, tuple)):
        return list(items[0])
    return list(items)


# ---------------------------------------------------------------------------
#   Synchronous helper: build a URL or local path
# ---------------------------------------------------------------------------

def generate_meme(
    template_id: str,
    *,
    text_lines: Optional[List[str]] = None,
    fmt: str = "png",
    font: str = "notosans",
    local_templates_path: Optional[str] = None,
) -> Dict[str, str]:
    """Returns a dict with either the meme URL / local path or an error."""

    captions: List[str] = _prepare_lines(text_lines or [])

    # --- Local file (no network) -----------------------------------------
    if local_templates_path:
        path = Path(local_templates_path) / f"{template_id}.{fmt}"
        if path.exists():
            return {"status": "success", "url": str(path.resolve())}
        return {"status": "error", "error": f"Template not found: {template_id}"}

    # --- Memegen URL ------------------------------------------------------
    slug = _clean_id(template_id)
    escaped = [_esc(line or "_") for line in captions]
    text_path = "/".join(escaped)
    url = f"https://api.memegen.link/images/{slug}/{text_path}.{fmt}?font={font}"
    return {"status": "success", "url": url}


# ---------------------------------------------------------------------------
#   Asynchronous tool: download the image and save it as an artifact
# ---------------------------------------------------------------------------

async def generate_meme_and_save(
    *,
    tool_context,
    template_id: str,
    text_lines: Optional[List[str]] = None,
    fmt: str = "png",
    font: str = "notosans",
    local_templates_path: Optional[str] = None,
) -> dict:
    """
    Generates a meme, saves it as an artifact, and returns a status dict
    with a success message.
    """
    try:
        # 1. Build the URL to fetch the meme image
        # ... (гэты блок застаецца без змен) ...
        result = generate_meme(
            template_id=template_id,
            text_lines=text_lines,
            fmt=fmt,
            font=font,
            local_templates_path=local_templates_path,
        )
        if result["status"] != "success":
            return result

        url = result["url"]

        # 2. Fetch the image bytes
        # ... (гэты блок застаецца без змен) ...
        if url.startswith("http"):
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=10) as resp:
                    if resp.status != 200:
                        return {"status": "error", "error": f"HTTP {resp.status} when fetching image"}
                    img_bytes = await resp.read()
                    output_mime_type = resp.headers.get("Content-Type", "image/png")
        else:
            path = Path(url)
            if not path.exists():
                return {"status": "error", "error": f"File not found: {url}"}
            img_bytes = path.read_bytes()
            output_mime_type = "image/png" if url.endswith(".png") else "image/jpeg"

        # 3. Save the image as an artifact
        # ... (гэты блок застаецца без змен) ...
        first_caption = (text_lines or ["meme"])[0]
        safe_prompt = re.sub(r"[^a-zA-Z0-9_-]", "_", first_caption.strip().lower())[:20]
        ext = "jpeg" if output_mime_type.endswith(("jpeg", "jpg")) else "png"
        filename = f"{safe_prompt or 'meme'}.{ext}"
        
        img_part = Part.from_bytes(data=img_bytes, mime_type=output_mime_type)
        await tool_context.save_artifact(filename=filename, artifact=img_part)

        # 4. Return a success message in a dictionary
        # <--- ВОСЬ КЛЮЧАВАЯ ЗМЕНА
        return {"status": "success", "message": "Мем створаны @Razumny_Agent_bot "}

    except Exception as exc:
        traceback.print_exc()
        return {"status": "error", "error": f"An unexpected error occurred: {exc!r}"}