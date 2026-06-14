import asyncio
import importlib
import os
import sys


sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _load_module():
    sys.modules.pop("tools.dictionary_tool", None)
    return importlib.import_module("tools.dictionary_tool")


def test_lookup_dictionary_combines_verbum_and_slounik_entries(monkeypatch):
    module = _load_module()

    monkeypatch.setattr(
        module,
        "lookup_verbum_entries",
        lambda word: [
            module.DictionaryEntry(
                source="Verbum",
                dictionary="Verbum",
                text="\u043d\u0430\u0437\u043e\u045e\u043d\u0456\u043a; Verbum entry",
                url="https://verbum.by/word",
            )
        ],
    )
    monkeypatch.setattr(
        module,
        "lookup_slounik_entries",
        lambda word, slounik_dicts=None: [
            module.DictionaryEntry(
                source="Slounik.org",
                dictionary="\u0421\u043b\u043e\u045e\u043d\u0456\u043a \u0431\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430\u0439 \u043c\u043e\u0432\u044b",
                text="\u0432\u043e\u0441\u0442\u0440\u0430\u045e - Slounik entry",
                url="https://slounik.org/search?dict=&search=%D0%B2",
            )
        ],
    )

    result = asyncio.run(module.lookup_dictionary("\u0432\u043e\u0441\u0442\u0440\u0430\u045e"))

    assert "\u0423 \u0441\u043b\u043e\u045e\u043d\u0456\u043a\u0430\u0445" in result.text
    assert "Verbum entry" in result.text
    assert "Slounik entry" in result.text


def test_lookup_dictionary_can_limit_to_slounik_source(monkeypatch):
    module = _load_module()
    called = {"verbum": False, "slounik": False}

    def verbum_entries(word):
        called["verbum"] = True
        return []

    def slounik_entries(word, slounik_dicts=None):
        called["slounik"] = True
        assert slounik_dicts == ["bn", "bulykabr"]
        return [
            module.DictionaryEntry(
                source="Slounik.org",
                dictionary="bn",
                text="\u0432\u043e\u0441\u0442\u0440\u0430\u045e",
                url="https://slounik.org/search",
            )
        ]

    monkeypatch.setattr(module, "lookup_verbum_entries", verbum_entries)
    monkeypatch.setattr(module, "lookup_slounik_entries", slounik_entries)

    result = asyncio.run(
        module.lookup_dictionary(
            "\u0432\u043e\u0441\u0442\u0440\u0430\u045e",
            sources=["slounik"],
            slounik_dicts=["bn", "bulykabr"],
        )
    )

    assert called == {"verbum": False, "slounik": True}
    assert "Slounik.org" in result.text


def test_lookup_slounik_entries_queries_each_dictionary_filter(monkeypatch):
    module = _load_module()
    requested_urls = []
    html = """
    <html><body>
      <main>
        <article>
          <p>1 \u0432\u043e\u0441\u0442\u0440\u0430\u045e -\u0430\u0432\u0430 // \u0421\u043b\u043e\u045e\u043d\u0456\u043a \u0431\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430\u0439 \u043c\u043e\u0432\u044b</p>
          <p>2 \u0430\u0441\u0442\u0440\u0430\u0432\u044b // \u0413\u0440\u0430\u043c\u0430\u0442\u044b\u0447\u043d\u044b \u043d\u0430\u0437\u043e\u045e\u043d\u0456\u043a\u0430</p>
        </article>
      </main>
    </body></html>
    """

    def fake_fetch_html(url):
        requested_urls.append(url)
        return module.parse_html(html)

    monkeypatch.setattr(module, "fetch_html", fake_fetch_html)

    entries = module.lookup_slounik_entries(
        "\u0432\u043e\u0441\u0442\u0440\u0430\u045e",
        slounik_dicts=["bn", "bulykabr"],
    )

    assert len(requested_urls) == 2
    assert "dict=bn" in requested_urls[0]
    assert "dict=bulykabr" in requested_urls[1]
    assert all(
        "search=%D0%B2%D0%BE%D1%81%D1%82%D1%80%D0%B0%D1%9E" in url
        for url in requested_urls
    )
    assert entries[0].source == "Slounik.org"
    assert entries[0].dictionary == "\u0411\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430-\u0440\u0430\u0441\u0435\u0439\u0441\u043a\u0456 (\u0411\u0430\u0439\u043a\u043e\u045e-\u041d\u0435\u043a\u0440\u0430\u0448\u044d\u0432\u0456\u0447)"


def test_slounik_dictionary_catalog_is_fixed_and_complete(monkeypatch):
    module = _load_module()

    monkeypatch.setattr(
        module,
        "fetch_html",
        lambda url: (_ for _ in ()).throw(AssertionError("must not fetch catalog")),
    )

    dictionaries = module.list_slounik_dictionaries()
    by_code = {item.code: item for item in dictionaries}

    assert len(dictionaries) == 96
    assert by_code["sbm"].name == "\u0421\u043b\u043e\u045e\u043d\u0456\u043a \u0431\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430\u0439 \u043c\u043e\u0432\u044b"
    assert by_code["krapivabr"].name == "\u0411\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430-\u0440\u0430\u0441\u0435\u0439\u0441\u043a\u0456 (\u041a\u0440\u0430\u043f\u0456\u0432\u0430)"
    assert by_code["bulykabr"].name == "\u0411\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430-\u0440\u0430\u0441\u0435\u0439\u0441\u043a\u0456 (\u0411\u0443\u043b\u044b\u043a\u0430)"


def test_slounik_dictionary_catalog_has_unique_codes():
    module = _load_module()

    codes = [item.code for item in module.list_slounik_dictionaries()]

    assert len(codes) == len(set(codes))


def test_lookup_slounik_entries_uses_catalog_name_for_filtered_dictionary(monkeypatch):
    module = _load_module()
    html = """
    <html><body>
      <main>
        <article>
          <ol class="results-list">
            <li><a href="https://slounik.org/1.html">1</a> \u0432\u043e\u0441\u0442\u0440\u0430\u045e -\u0430\u0432\u0430</li>
          </ol>
        </article>
      </main>
    </body></html>
    """

    monkeypatch.setattr(module, "fetch_html", lambda url: module.parse_html(html))

    entries = module.lookup_slounik_entries("\u0432\u043e\u0441\u0442\u0440\u0430\u045e", slounik_dicts=["bn"])

    assert entries[0].dictionary == "\u0411\u0435\u043b\u0430\u0440\u0443\u0441\u043a\u0430-\u0440\u0430\u0441\u0435\u0439\u0441\u043a\u0456 (\u0411\u0430\u0439\u043a\u043e\u045e-\u041d\u0435\u043a\u0440\u0430\u0448\u044d\u0432\u0456\u0447)"
