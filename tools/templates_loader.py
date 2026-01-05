"""
Загрузка лакальнага каталога шаблонаў і
хуткі fuzzy-пошук па ім (RapidFuzz).
"""
from __future__ import annotations

from pathlib import Path
import json
from rapidfuzz import fuzz, process

# ---------- loader ----------
def load_templates(path: str | Path) -> list[dict]:
    with Path(path).open(encoding="utf-8") as f:
        return json.load(f)

# ---------- searchable index ----------
class TemplateIndex:
    def __init__(self, templates: list[dict]):
        # list of ("id", "searchable_doc")
        self._docs = [
            (
                t["id"],
                f"{t['name']} {' '.join(t.get('example', {}).get('text', []))}"
            )
            for t in templates
        ]


    def top(self, query: str, k: int = 3) -> list[str]:
        # Create a dictionary for rapidfuzz to search, with the index as the key
        choices = {i: doc for i, (tpl_id, doc) in enumerate(self._docs)}
        matches = process.extract(
            query, choices,
            scorer=fuzz.WRatio,
            limit=k,
        )
        # Map the index back to the original template ID
        return [self._docs[idx][0] for _score, _string, idx in matches]
