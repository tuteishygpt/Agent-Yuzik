"""
Tool-функцыя для Google ADK:
шукае ў лакальным каталогу Memegen і вяртае top-k slug-ідэнтыфікатараў.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

from .templates_loader import load_templates, TemplateIndex

# ------------------------------------------------------------
# Шлях да лакальнага каталогу з шаблонамі
_TEMPLATES_PATH = Path(__file__).parent / "data" / "memegen_templates.json"

# Загружаем адзін раз пры імпарце
_TPL_INDEX = TemplateIndex(load_templates(_TEMPLATES_PATH))


def suggest_templates(query: str, k: int = 3) -> dict[str, List[str]]:
    """
    Вяртае top-k slug-ідэнтыфікатараў (id) для Memegen.

    Args:
        query: натуральная мова карыстальніка.
        k: колькі варыянтаў патрэбна (па змаўчанні 3).

    Returns:
        {"status": "success", "template_ids": ["gb", "drake", "doge"]}
    """
    top_ids: List[str] = _TPL_INDEX.top(query, k=k)
    return {"status": "success", "template_ids": top_ids}
