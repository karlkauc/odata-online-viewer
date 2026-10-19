"""Security-focused tests: headers, DTD pre-filter, SSRF guard, credential rules."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from lxml import etree

from app.main import app
from app.parser import security
from app.parser.security import SecurityError, _verify_url, fetch_url, inspect_dtd, normalize_url


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


# --- Security headers -------------------------------------------------------


def test_security_headers_on_api(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.headers["Strict-Transport-Security"].startswith("max-age=")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "Content-Security-Policy" in r.headers
    assert r.headers["Cache-Control"] == "no-store"


# --- DTD pre-filter ---------------------------------------------------------


def test_entity_hidden_deep_in_the_document_is_rejected(client: TestClient) -> None:
    payload = "<edmx:Edmx xmlns:edmx='x'>" + ("x" * 5000) + "<!-- <!ENTITY a 'b'> --></edmx:Edmx>"
    r = client.post("/api/metadata/text", json={"content": payload, "filename": "x.xml"})
    assert r.status_code == 400
    assert "DTD" in r.json()["detail"]


def test_doctype_without_subset_is_accepted() -> None:
    doc = b'<?xml version="1.0"?><!DOCTYPE note SYSTEM "note.dtd"><note><to>x</to></note>'
    assert inspect_dtd(doc) is True


@pytest.mark.parametrize(
    "subset",
    [
        b'<!ENTITY ext SYSTEM "file:///etc/passwd">',
        b'<!ENTITY a "&b;&b;"><!ENTITY b "x">',
        b'<!ENTITY % p "x">%p;',
    ],
)
def test_unsafe_subsets_rejected(subset: bytes) -> None:
    with pytest.raises(SecurityError):
        inspect_dtd(b"<!DOCTYPE a [" + subset + b"]><a/>")


# --- SSRF: private-resolving host blocked; pinning returns validated IP ------


def test_verify_url_blocks_private(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "_resolve_all_addrs", lambda host: ["127.0.0.1"])
    with pytest.raises(SecurityError):
        _verify_url("https://evil.example.com/odata/$metadata")


def test_verify_url_returns_pinned_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "_resolve_all_addrs", lambda host: ["8.8.8.8"])
    host, ip = _verify_url("https://example.com/odata/$metadata")
    assert host == "example.com"
    assert ip == "8.8.8.8"


def test_fetch_url_blocks_private(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "_resolve_all_addrs", lambda host: ["10.0.0.5"])
    with pytest.raises(SecurityError):
        fetch_url("https://internal.example.com/odata/$metadata")


def test_url_loader_refuses_private_hosts(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(security, "_resolve_all_addrs", lambda host: ["192.168.1.10"])
    r = client.post("/api/metadata/url", json={"url": "https://intranet.example.com/odata/"})
    assert r.status_code == 400
    assert "private" in r.json()["detail"]


# --- Credentials only over https --------------------------------------------


def test_credentials_are_not_sent_over_plain_http() -> None:
    with pytest.raises(SecurityError, match="https"):
        fetch_url("http://example.com/odata/$metadata", headers={"Authorization": "Basic eDp5"})


def test_url_loader_rejects_http_with_credentials(client: TestClient) -> None:
    r = client.post(
        "/api/metadata/url",
        json={"url": "http://example.com/odata/", "auth": {"username": "u", "password": "p"}},
    )
    assert r.status_code == 400
    assert "https" in r.json()["detail"]


# --- Scheme-less URLs get https://; other schemes stay rejected --------------


@pytest.mark.parametrize(
    ("pasted", "expected"),
    [
        (
            "services.odata.org/V4/Northwind/Northwind.svc/",
            "https://services.odata.org/V4/Northwind/Northwind.svc/",
        ),
        ("  example.org/odata  ", "https://example.org/odata"),
        ("example.org:8443/odata", "https://example.org:8443/odata"),
        ("http://example.org/odata", "http://example.org/odata"),
    ],
)
def test_scheme_less_urls_get_https(pasted: str, expected: str) -> None:
    assert normalize_url(pasted) == expected


@pytest.mark.parametrize(
    "url", ["ftp://example.org/a", "file:///etc/passwd", "mailto:x@y.z", "localhost/odata", "notes"]
)
def test_other_input_is_left_for_the_fetcher_to_reject(url: str) -> None:
    assert normalize_url(url) == url
    with pytest.raises(SecurityError, match="only http"):
        fetch_url(url)


SPLIT_COMMENT_SUBSET = '<!ENTITY a "<!--"><!ENTITY x SYSTEM "file://{path}"><!ENTITY b "-->">'


def test_comment_split_across_entity_values_is_rejected(tmp_path) -> None:
    canary = tmp_path / "canary.txt"
    canary.write_text("CANARY-SECRET")
    doc = f"<!DOCTYPE r [{SPLIT_COMMENT_SUBSET.format(path=canary)}]><r>&x;</r>".encode()
    with pytest.raises(SecurityError):
        inspect_dtd(doc)


def test_internal_entity_parser_never_reads_external_entities(tmp_path) -> None:
    canary = tmp_path / "canary.txt"
    canary.write_text("CANARY-SECRET")
    doc = f'<!DOCTYPE r [<!ENTITY x SYSTEM "file://{canary}">]><r>&x;</r>'.encode()
    with pytest.raises(etree.XMLSyntaxError):
        etree.fromstring(doc, security.make_parser(internal_entities=True))


def test_comment_split_xxe_through_the_api(client: TestClient, tmp_path) -> None:
    canary = tmp_path / "canary.txt"
    canary.write_text("CANARY-SECRET")
    subset = SPLIT_COMMENT_SUBSET.format(path=canary)
    doc = (
        f"<!DOCTYPE edmx:Edmx [{subset}]>"
        '<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices>'
        '<Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="N">'
        '<EntityType Name="T"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.Int32"/>'
        '<Annotation Term="Core.Description" String="&x;"/></EntityType>'
        "</Schema></edmx:DataServices></edmx:Edmx>"
    )
    r = client.post("/api/metadata/text", json={"content": doc, "filename": "x.xml"})
    assert r.status_code == 400
    assert "CANARY-SECRET" not in r.text
