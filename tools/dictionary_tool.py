from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlencode, urljoin

from google.adk.tools import FunctionTool
from google.genai import types

from tools.verbum_tool import (
    GRAMMAR_URL,
    VerbumDependencyError,
    clean_spaces,
    fetch_article_full_text,
    fetch_html,
    normalize_text,
    parse_html,
    search_all_result_urls,
    try_grammardb_full_text,
)


SLOUNIK_BASE_URL = "https://slounik.org"
DEFAULT_SOURCES = ("verbum", "slounik")
SOURCE_ALIASES = {
    "verbum": "verbum",
    "slounik": "slounik",
    "slounik.org": "slounik",
}


@dataclass(frozen=True)
class DictionaryEntry:
    source: str
    dictionary: str
    text: str
    url: str | None = None


@dataclass(frozen=True)
class SlounikDictionary:
    code: str
    name: str


SLOUNIK_DICTIONARIES: tuple[SlounikDictionary, ...] = (
    SlounikDictionary("sbm", "Слоўнік беларускай мовы"),
    SlounikDictionary("nazounik", "Граматычны назоўніка"),
    SlounikDictionary("nazounik2013", "Граматычны слоўнік назоўніка 2013"),
    SlounikDictionary("dzsl", "Граматычны дзеяслова"),
    SlounikDictionary("dzsl2013", "Граматычны слоўнік дзеяслова 2013"),
    SlounikDictionary("prym", "Граматычны прыметніка, займенніка, лічэбніка, прыслоўя"),
    SlounikDictionary("prym2013", "Граматычны слоўнік прыметніка, займенніка, лічэбніка, прыслоўя 2013"),
    SlounikDictionary("paronimy", "Паронімаў"),
    SlounikDictionary("epitety", "Эпітэтаў"),
    SlounikDictionary("sinonimyk", "Сінонімаў (Клышка)"),
    SlounikDictionary("bkp2005", "Клясычны правапіс"),
    SlounikDictionary("tlum", "Тлумачальны"),
    SlounikDictionary("tsbm", "Тлумачальны (вялікі)"),
    SlounikDictionary("slovaklad", "Адметная лексіка"),
    SlounikDictionary("prynaz", "Тлумачальны прыназоўнікаў"),
    SlounikDictionary("fraza", "Этымалагічны фразеалагізмаў"),
    SlounikDictionary("starbiel", "Старабеларускі лексікон"),
    SlounikDictionary("hsbm", "Гістарычны (ГСБМ)"),
    SlounikDictionary("calaviek", "Чалавек (дыялект.)"),
    SlounikDictionary("zyvioly", "Жывёльны свет (дыялект.)"),
    SlounikDictionary("rasliny", "Раслінны свет (дыялект.)"),
    SlounikDictionary("sielhas", "Сельская гаспадарка (дыялект.)"),
    SlounikDictionary("dyjalekt", "Дыялектнае слова"),
    SlounikDictionary("krajovy", "Усходняя Магілеўшчына (Бялькевіч)"),
    SlounikDictionary("viciebscyna", "Віцебшчына"),
    SlounikDictionary("vusaccyna", "Вушаччына (Барадулін)"),
    SlounikDictionary("lahojsk", "Прыказкі Лагойшчыны"),
    SlounikDictionary("paraunanni", "Беларускія народныя параўнанні"),
    SlounikDictionary("roznajes", "Рознае (слоўнікі)"),
    SlounikDictionary("nb", "Расейска-беларускі (Некрашэвіч-Байкоў)"),
    SlounikDictionary("bulykarb", "Расейска-беларускі (Булыка)"),
    SlounikDictionary("krapivarb", "Расейска-беларускі (Крапіва)"),
    SlounikDictionary("vlastrb", "Расейска-беларускі (Ластоўскі)"),
    SlounikDictionary("sanko", "Расейска-беларускі прыказак, прымавак і фразем"),
    SlounikDictionary("batanrb", "Расейска-беларускі батанічны"),
    SlounikDictionary("lingrb", "Расейска-беларускі лінгвістычных тэрмінаў"),
    SlounikDictionary("miedrb", "Расейска-беларускі медыцынскіх тэрмінаў"),
    SlounikDictionary("fizyjarb", "Расейска-беларускі кароткі фізыялягічны"),
    SlounikDictionary("farmarb", "Расейска-беларускі кароткі фармакалагічны"),
    SlounikDictionary("bijarb", "Расейска-беларускі біялагічных тэрмінаў"),
    SlounikDictionary("lashasrb", "Расейска-беларускі тэрмінаў па сельскай і лясной гаспадарцы"),
    SlounikDictionary("ekanamrb", "Расейска-беларускі кароткі эканамічных тэрмінаў"),
    SlounikDictionary("ekanam2rb", "Расейска-беларускі эканамічнай тэрміналогіі"),
    SlounikDictionary("fizmat", "Расейска-беларускі мат., фіз. і тэхн. тэрмінаў"),
    SlounikDictionary("matrb", "Расейска-беларускі матэматычных тэрмінаў"),
    SlounikDictionary("cyhunrb", "Расейска-беларускі кароткі чыгуначны"),
    SlounikDictionary("vajskovy", "Расейска-беларускі вайсковы"),
    SlounikDictionary("bn", "Беларуска-расейскі (Байкоў-Некрашэвіч)"),
    SlounikDictionary("bulykabr", "Беларуска-расейскі (Булыка)"),
    SlounikDictionary("stanbr", "Беларуска-расейскі (Станкевіч)"),
    SlounikDictionary("krapivabr", "Беларуска-расейскі (Крапіва)"),
    SlounikDictionary("biez", "Беларуска-расейскі безэквівалентнай лексікі"),
    SlounikDictionary("miedbr", "Беларуска-расейскі медыцынскіх тэрмінаў"),
    SlounikDictionary("vierasbr", "Беларуска-расейскі батанічны (Верас)"),
    SlounikDictionary("polisemija", "Беларуска-расейскі: міжмоўныя амонімы, паронімы і полісемія"),
    SlounikDictionary("bnt01", "Элемэнтарная матэматыка (БНТ)"),
    SlounikDictionary("bnt02", "Практыка і тэорыя літаратурнага мастацтва (БНТ)"),
    SlounikDictionary("bnt03", "Географічныя й космографічныя тэрміны і назовы нябесных цел (БНТ)"),
    SlounikDictionary("bnt04", "Тэрмінолёгія лёгікі і псыхолёгіі (БНТ)"),
    SlounikDictionary("bnt05", "Геолёгія, мінэралёгія, крышталёграфія (БНТ)"),
    SlounikDictionary("bnt06a", "Ботаніка. Агульная (БНТ)"),
    SlounikDictionary("bnt06b", "Ботаніка. Спэцыяльная (БНТ)"),
    SlounikDictionary("bnt07", "Музычныя тэрміны (БНТ)"),
    SlounikDictionary("bnt08", "Слоўнік лясных тэрмінаў (БНТ)"),
    SlounikDictionary("bnt09", "Nomina anatomica alboruthenica (выпуск I) (БНТ)"),
    SlounikDictionary("bnt10", "Тэрмінолёгія права (БНТ)"),
    SlounikDictionary("bnt11", "Тэрмінолёгія грамадазнаўства (БНТ)"),
    SlounikDictionary("bnt12", "Назовы жывёл (БНТ)"),
    SlounikDictionary("bnt13", "Nomina Anatomica Alboruthenica (выпуск II) (БНТ)"),
    SlounikDictionary("bnt14", "Слоўнік матэматычнае тэрмінолёгіі (проект) (БНТ)"),
    SlounikDictionary("bnt15", "Граматычна-лінгвістычная тэрмінолёгія (БНТ)"),
    SlounikDictionary("bnt16", "Слоўнік глебазнаўчае тэрмінолёгіі (праект) (БНТ)"),
    SlounikDictionary("bnt17", "Бугальтэрская тэрмінолёгія (БНТ)"),
    SlounikDictionary("bnt18", "Слоўнік хэмічнае тэрмінолёгіі (проект) (БНТ)"),
    SlounikDictionary("bnt19", "Слоўнік сельска-гаспадарчае тэрмінолёгіі (праект) (БНТ)"),
    SlounikDictionary("bnt20", "Nomina Anatomica Alboruthenica (выпуск III) (БНТ)"),
    SlounikDictionary("bnt21", "Слоўнік фізічнае тэрмінолёгіі (праект) (БНТ)"),
    SlounikDictionary("bnt23", "Слоўнік пэдагогічных дысцыплін (праект) (БНТ)"),
    SlounikDictionary("bnt24", "Слоўнік тэрміналёгіі агульнае расьлінагадоўлі (праект) (БНТ)"),
    SlounikDictionary("bnt25", "Практычны беларускі вайсковы слоўнік"),
    SlounikDictionary("bnt26", "Тэхнічная тэрміналёгія"),
    SlounikDictionary("bnt27", "Расейска-беларускі (тэхнічная тэрміналёгія)"),
    SlounikDictionary("bnt28", "Ваенны руска-беларускі слоўнік"),
    SlounikDictionary("bnt29", "Беларуска-літоўскі тэрміналагічны слоўнік"),
    SlounikDictionary("palihrafab", "Ангельска-беларускі выдавецкіх і паліграфічных тэрмінаў"),
    SlounikDictionary("palihrafba", "Беларуска-ангельскі выдавецкіх і паліграфічных тэрмінаў"),
    SlounikDictionary("matba", "Беларуска-ангельскі матэматычных тэрмінаў"),
    SlounikDictionary("susaab", "Ангельска-беларускі (Суша)"),
    SlounikDictionary("paskievicab", "Ангельска-беларускі (Пашкевіч)"),
    SlounikDictionary("malyab", "Ангельска-беларускі (малы)"),
    SlounikDictionary("pbs", "Польска-беларускі"),
    SlounikDictionary("vierasbp", "Беларуска-польскі батанічны (Верас)"),
    SlounikDictionary("prykazkilb", "Лацінска-беларускі прыказак, прымавак і крылатых слоў"),
    SlounikDictionary("prykazkiib", "Ідыш-беларускі прыказак і прымавак"),
    SlounikDictionary("ubs", "Беларуска-ўкраінскі"),
    SlounikDictionary("vuhb", "Вугорска-беларускі"),
)


def list_slounik_dictionaries() -> tuple[SlounikDictionary, ...]:
    return SLOUNIK_DICTIONARIES


def _slounik_dictionary_name(dict_code: str) -> str | None:
    for item in SLOUNIK_DICTIONARIES:
        if item.code == dict_code:
            return item.name
    return None


def _normalize_sources(sources: list[str] | None) -> tuple[str, ...]:
    if not sources:
        return DEFAULT_SOURCES

    normalized: list[str] = []
    for source in sources:
        canonical = SOURCE_ALIASES.get(str(source).casefold().strip())
        if canonical and canonical not in normalized:
            normalized.append(canonical)
    return tuple(normalized) or DEFAULT_SOURCES


def _dedupe_entries(entries: Iterable[DictionaryEntry]) -> list[DictionaryEntry]:
    deduped: list[DictionaryEntry] = []
    seen: set[tuple[str, str, str]] = set()
    for entry in entries:
        text = clean_spaces(entry.text)
        if not text:
            continue
        key = (entry.source, entry.dictionary, text)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(
            DictionaryEntry(
                source=entry.source,
                dictionary=entry.dictionary,
                text=text,
                url=entry.url,
            )
        )
    return deduped


def _entry_excerpt(text: str, max_chars: int = 700) -> str:
    text = clean_spaces(text)
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip() + "..."


def lookup_verbum_entries(word: str) -> list[DictionaryEntry]:
    query = normalize_text(word)
    grammar_texts = try_grammardb_full_text(query)
    if grammar_texts:
        return [
            DictionaryEntry(
                source="Verbum",
                dictionary="Verbum grammar DB",
                text=text,
                url=GRAMMAR_URL + query,
            )
            for text in grammar_texts
        ]

    entries: list[DictionaryEntry] = []
    for url in search_all_result_urls(query):
        text = fetch_article_full_text(url)
        if text:
            entries.append(
                DictionaryEntry(
                    source="Verbum",
                    dictionary="Verbum",
                    text=text,
                    url=url,
                )
            )
    return entries


def _slounik_search_url(word: str, dict_code: str = "") -> str:
    query = urlencode({"dict": dict_code.strip(), "search": normalize_text(word)})
    return f"{SLOUNIK_BASE_URL}/search?{query}"


def _dictionary_name_from_slounik_item(item) -> str:
    links = item.select("a[href]")
    if len(links) >= 2:
        text = clean_spaces(links[-1].get_text(" ", strip=True))
        if text:
            return text

    text = clean_spaces(item.get_text(" ", strip=True))
    if "//" in text:
        tail = text.rsplit("//", 1)[-1].strip()
        if tail:
            return tail
    return "Slounik.org"


def lookup_slounik_entries(
    word: str,
    slounik_dicts: list[str] | None = None,
    limit: int = 8,
) -> list[DictionaryEntry]:
    entries: list[DictionaryEntry] = []
    dict_codes = [item.strip() for item in slounik_dicts or [] if item.strip()] or [""]
    per_dictionary_limit = max(limit, 1) if len(dict_codes) == 1 else limit

    for dict_code in dict_codes:
        url = _slounik_search_url(word, dict_code=dict_code)
        filtered_dictionary_name = _slounik_dictionary_name(dict_code) if dict_code else None
        soup = fetch_html(url)
        items = soup.select("ol.results-list > li")
        if not items:
            article = soup.select_one("article")
            items = article.select("p") if article else []

        for item in items:
            text = clean_spaces(item.get_text(" ", strip=True))
            if not text:
                continue
            result_url = url
            first_link = item.select_one("a[href]")
            if first_link:
                result_url = urljoin(SLOUNIK_BASE_URL, first_link.get("href") or "")
            entries.append(
                DictionaryEntry(
                    source="Slounik.org",
                    dictionary=filtered_dictionary_name or _dictionary_name_from_slounik_item(item),
                    text=text,
                    url=result_url,
                )
            )
            if len(entries) >= per_dictionary_limit:
                break
        if len(entries) >= limit:
            break
    return _dedupe_entries(entries)[:limit]


def _format_dictionary_response(word: str, entries: list[DictionaryEntry]) -> str:
    if not entries:
        return f"У слоўніках нічога не знойдзена для: {word}."

    lines = [f"У слоўніках для «{word}»:"]
    for entry in entries[:8]:
        lines.append(
            f"- {entry.source} / {entry.dictionary}: {_entry_excerpt(entry.text)}"
        )
    return "\n".join(lines)


async def lookup_dictionary(
    word: str,
    sources: list[str] | None = None,
    slounik_dicts: list[str] | None = None,
) -> types.Part:
    query = normalize_text(word)
    entries: list[DictionaryEntry] = []
    errors: list[str] = []

    for source in _normalize_sources(sources):
        try:
            if source == "verbum":
                entries.extend(lookup_verbum_entries(query))
            elif source == "slounik":
                entries.extend(
                    lookup_slounik_entries(query, slounik_dicts=slounik_dicts)
                )
        except VerbumDependencyError:
            return types.Part(
                text=(
                    "Інструмент слоўнікаў недаступны: не ўсталяваны пакет "
                    "beautifulsoup4."
                )
            )
        except Exception:
            errors.append(source)

    entries = _dedupe_entries(entries)
    text = _format_dictionary_response(query, entries)
    if errors and entries:
        text += "\n\nЧастка слоўнікаў часова недаступная: " + ", ".join(errors) + "."
    elif errors and not entries:
        text = "Не ўдалося атрымаць даныя са слоўнікаў. Паспрабуй крыху пазней."
    return types.Part(text=text)


class DictionaryTool(FunctionTool):
    """ADK tool wrapper with a manual declaration compatible with Vertex AI."""

    def _get_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "word": types.Schema(
                        type=types.Type.STRING,
                        description="Belarusian word to look up in dictionaries.",
                    ),
                    "sources": types.Schema(
                        type=types.Type.ARRAY,
                        items=types.Schema(type=types.Type.STRING),
                        description="Optional source filter: verbum or slounik.",
                    ),
                    "slounik_dicts": types.Schema(
                        type=types.Type.ARRAY,
                        items=types.Schema(type=types.Type.STRING),
                        description="Optional Slounik.org dictionary code filter.",
                    ),
                },
                required=["word"],
            ),
        )


dictionary_tool = DictionaryTool(lookup_dictionary)

__all__ = [
    "DictionaryEntry",
    "SlounikDictionary",
    "SLOUNIK_DICTIONARIES",
    "dictionary_tool",
    "list_slounik_dictionaries",
    "lookup_dictionary",
    "lookup_slounik_entries",
    "lookup_verbum_entries",
    "parse_html",
]
