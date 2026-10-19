"""Server-rendered content pages, home FAQ, sitemap and IndexNow key (app.content, app.spa)."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.spa as spa_module
from app.config import settings
from app.content import pages as pages_module
from app.content.pages import Page, all_pages, home_faq, parse_page
from app.content.render import render_page
from app.spa import mount_spa, render_shell

SHELL = (
    "<html><head><title>x</title>"
    '<meta name="description" content="d" />'
    '<link rel="canonical" href="c" />'
    '<meta property="og:title" content="t" />'
    '<meta property="og:description" content="d" />'
    '<meta property="og:url" content="u" />'
    "<!--faq-jsonld--></head><body><main>spa<!--faq--></main></body></html>"
)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text(SHELL)
    app = FastAPI()
    mount_spa(app, tmp_path)
    emitted: list[tuple[str, dict]] = []
    monkeypatch.setattr(spa_module, "emit", lambda event_type, **f: emitted.append((event_type, f)))
    return TestClient(app), emitted


def test_every_bundled_page_parses_and_renders() -> None:
    pages = all_pages()
    assert pages, "no content pages found"
    for page in pages.values():
        assert page.title and page.description, page.slug
        doc = render_page(page, "https://example.test")
        assert f'<link rel="canonical" href="https://example.test/{page.slug}" />' in doc
        assert "<h1>" in doc
        for block in re.findall(r'<script type="application/ld\+json">\n(.*?)\n</script>', doc, re.S):
            json.loads(block)


def test_front_matter_is_required() -> None:
    with pytest.raises(ValueError):
        parse_page("x", "# no front matter")


def test_page_fields_and_markdown_escaping() -> None:
    page = parse_page(
        "guides/x",
        '+++\ntitle = "T"\ndescription = "D"\ncta_label = "Go"\ncta_href = "/?sample=a"\n'
        '[[faq]]\nq = "Q?"\na = "A `code`"\n+++\nHello <script>alert(1)</script>\n',
    )
    doc = render_page(page, "https://example.test")
    assert "<script>alert(1)</script>" not in doc
    assert 'href="/?sample=a"' in doc
    assert '"@type": "FAQPage"' in doc
    assert "<code>code</code>" in doc


def test_content_route_served_with_page_view(client) -> None:
    c, emitted = client
    slug = next(iter(all_pages()))
    r = c.get(f"/{slug}?utm_source=hn&utm_campaign=Launch")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert "Content-Security-Policy" in r.headers
    assert emitted == [
        ("page_view", {"path": f"/{slug}", "status_code": 200, "utm_source": "hn", "utm_campaign": "launch"})
    ]


def test_unknown_content_path_is_404(client) -> None:
    c, emitted = client
    assert c.get("/features/does-not-exist").status_code == 404
    assert emitted == []


def test_home_shell_gets_faq_other_routes_do_not() -> None:
    home = render_shell(SHELL, "")
    assert home_faq()
    assert home.count('<details class="faq">') == len(home_faq())
    assert '"@type": "FAQPage"' in home
    other = render_shell(SHELL, "about")
    assert "<!--faq" not in other
    assert "FAQPage" not in other


def test_sitemap_lists_routes_and_pages(client) -> None:
    c, _ = client
    r = c.get("/sitemap.xml")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/xml")
    locs = re.findall(r"<loc>(.*?)</loc>", r.text)
    assert f"{settings.site_origin}/" in locs
    assert f"{settings.site_origin}/samples" in locs
    for page in all_pages().values():
        assert (f"{settings.site_origin}/{page.slug}" in locs) is not page.noindex


def test_provider_pages_are_registered(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pages_module, "_providers", [])
    pages_module.all_pages.cache_clear()
    pages_module.register_provider(lambda: [Page(slug="generated/x", title="T", description="D", body="b")])
    try:
        assert pages_module.get_page("generated/x") is not None
    finally:
        monkeypatch.undo()
        pages_module.all_pages.cache_clear()


def test_indexnow_key_file(client, monkeypatch: pytest.MonkeyPatch) -> None:
    c, _ = client
    monkeypatch.setattr(settings, "indexnow_key", "abc123")
    r = c.get("/abc123.txt")
    assert r.status_code == 200 and r.text == "abc123"
    monkeypatch.setattr(settings, "indexnow_key", "")
    assert c.get("/abc123.txt").status_code == 404
