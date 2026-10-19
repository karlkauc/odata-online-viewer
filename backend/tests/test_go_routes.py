"""Counted outbound redirects (app/api/go.py)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


def _client() -> TestClient:
    return TestClient(app, follow_redirects=False)


def test_default_goes_to_the_docs_site() -> None:
    response = _client().get("/go/freexmltoolkit")
    assert response.status_code == 302
    assert response.headers["location"] == "https://karlkauc.github.io/FreeXmlToolkit/"


def test_releases_target_and_unknown_fallback() -> None:
    client = _client()
    assert (
        client.get("/go/freexmltoolkit", params={"to": "releases"}).headers["location"]
        == "https://github.com/karlkauc/FreeXmlToolkit/releases"
    )
    assert (
        client.get("/go/freexmltoolkit", params={"to": "https://evil.example"}).headers["location"]
        == "https://karlkauc.github.io/FreeXmlToolkit/"
    )


def test_sponsor_goes_to_github_sponsors() -> None:
    response = _client().get("/go/sponsor")
    assert response.status_code == 302
    assert response.headers["location"] == "https://github.com/sponsors/karlkauc"


def test_other_go_paths_are_404() -> None:
    assert _client().get("/go/unknown").status_code == 404


def test_sister_redirects_carry_utm_source() -> None:
    client = _client()
    xsd = client.get("/go/xsd-viewer")
    assert xsd.status_code == 302
    assert xsd.headers["location"] == "https://www.xsd-viewer.online/?utm_source=odata-viewer&utm_medium=sister"
    assert client.get("/go/xml-viewer").headers["location"].startswith("https://www.xml-viewer.online/?utm_source=")
    # Our own entry (FamilyFooter is identical on all sites) needs no campaign tag.
    assert client.get("/go/odata-viewer").headers["location"] == "https://www.odata-viewer.online/"


def test_share_ping_is_204() -> None:
    client = _client()
    assert client.post("/api/usage/share", params={"source": "query"}).status_code == 204
    assert client.post("/api/usage/share", params={"source": "anything"}).status_code == 204


def test_content_faq_api() -> None:
    entries = _client().get("/api/content/faq").json()
    assert entries and all(e["question"] and e["answer_html"].startswith("<p>") for e in entries)
