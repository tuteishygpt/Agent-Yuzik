from __future__ import annotations

import re
import unicodedata
from typing import Any
from urllib.parse import quote, urljoin

import requests
from google.adk.tools import FunctionTool
from google.genai import types


BASE_URL = "https://verbum.by"
GRAMMAR_URL = f"{BASE_URL}/grammardb/"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; VerbumADKTool/1.0)"})
GRAMMAR_MARKERS = (
    "дзеяслоў",
    "назоўнік",
    "прыметнік",
    "займеннік",
    "прыслоўе",
    "лічэбнік",
    "мужчынскі род",
    "жаночы род",
    "ніякі род",
    "адзіночны лік",
    "множны лік",
    "загадны лад",
    "прошлы час",
    "цяперашні час",
    "будучы час",
)
NOISY_LINK_PARTS = ("/?q=", "/search", "/login", "/register", "/tag/", "/category/", "/feed")


class VerbumDependencyError(RuntimeError):
    """Raised when an optional runtime dependency for the Verbum tool is missing."""


def normalize_text(text: str) -> str:
    return unicodedata.normalize("NFC", text.strip())


def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def clean_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _get_beautifulsoup():
    try:
        from bs4 import BeautifulSoup  # type: ignore
    except ModuleNotFoundError as exc:
        raise VerbumDependencyError("beautifulsoup4 is not installed") from exc
    return BeautifulSoup


def parse_html(text: str):
    return _get_beautifulsoup()(text, "html.parser")


def fetch_html(url: str):
    response = SESSION.get(url, timeout=20)
    response.raise_for_status()
    return parse_html(response.text)


def extract_best_text_block(soup: Any) -> str:
    for selector in ("main", "article", ".content", ".article", ".entry-content", ".post-content"):
        for node in soup.select(selector):
            text = clean_spaces(node.get_text(" ", strip=True))
            if text:
                return text
    return clean_spaces(soup.get_text(" ", strip=True))


def try_grammardb_full_text(word: str) -> list[str]:
    try:
        soup = fetch_html(GRAMMAR_URL + quote(word, safe=""))
    except VerbumDependencyError:
        raise
    except Exception:
        return []
    full_text = extract_best_text_block(soup)
    lowered = full_text.lower()
    if full_text and any(marker in lowered for marker in GRAMMAR_MARKERS):
        return [full_text]
    return []


def search_all_result_urls(word: str, limit: int = 20) -> list[str]:
    query = strip_accents(word).lower()
    try:
        soup = fetch_html(f"{BASE_URL}/?q={quote(query, safe='')}")
    except VerbumDependencyError:
        raise
    except Exception:
        return []

    urls: list[str] = []
    seen: set[str] = set()
    for anchor in soup.select("a[href]"):
        href = (anchor.get("href") or "").strip()
        title = clean_spaces(anchor.get_text(" ", strip=True))
        if not href or not title or href.startswith("#"):
            continue
        if any(part in href for part in NOISY_LINK_PARTS):
            continue
        full_url = href if href.startswith("http") else urljoin(BASE_URL, href)
        haystack = strip_accents(title).lower()
        if query and query not in haystack:
            continue
        if not full_url.startswith(BASE_URL) or full_url in seen:
            continue
        seen.add(full_url)
        urls.append(full_url)
        if len(urls) >= limit:
            break
    return urls


def fetch_article_full_text(url: str) -> str | None:
    try:
        soup = fetch_html(url)
    except VerbumDependencyError:
        raise
    except Exception:
        return None
    full_text = extract_best_text_block(soup)
    return full_text or None


def _summarize_texts(word: str, texts: list[str]) -> str:
    cleaned: list[str] = []
    seen: set[str] = set()
    for text in texts:
        normalized = clean_spaces(text)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(normalized)
    joined = " ".join(cleaned[:2])
    if joined:
        return f"У Verbum для «{word}»: {joined}"
    return f"У Verbum нічога не знойдзена для: {word}."


async def lookup_verbum(word: str):
    query = normalize_text(word)
    try:
        grammar_texts = try_grammardb_full_text(query)
        if grammar_texts:
            return types.Part(text=_summarize_texts(query, grammar_texts))

        urls = search_all_result_urls(query)
        if not urls:
            return types.Part(text=f"У Verbum нічога не знойдзена для: {query}.")

        article_texts = [fetch_article_full_text(url) for url in urls]
        article_texts = [text for text in article_texts if text]
        if not article_texts:
            return types.Part(text=f"У Verbum нічога не знойдзена для: {query}.")

        return types.Part(text=_summarize_texts(query, article_texts))
    except VerbumDependencyError:
        return types.Part(text="Інструмент Verbum недаступны: не ўсталяваны пакет beautifulsoup4.")
    except Exception:
        return types.Part(text="Не ўдалося атрымаць даныя з Verbum. Паспрабуй крыху пазней.")


verbum_tool = FunctionTool(lookup_verbum)

__all__ = ["VerbumDependencyError", "lookup_verbum", "parse_html", "verbum_tool"]
