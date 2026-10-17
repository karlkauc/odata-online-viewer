"""SPA fallback: only known routes get the shell; scanner paths get 404 and no page_view."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.spa as spa_module
from app.spa import ROUTE_META, mount_spa, render_shell

SHELL = (
    "<html><head><title>x</title>"
    '<meta name="description" content="d" />'
    '<link rel="canonical" href="c" />'
    '<meta property="og:title" content="t" />'
    '<meta property="og:description" content="d" />'
    '<meta property="og:url" content="u" />'
    "</head><body>spa</body></html>"
)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text(SHELL)
    (tmp_path / "theme-init.js").write_text("// js")
    app = FastAPI()
    mount_spa(app, tmp_path)
    emitted: list[tuple[str, dict]] = []
    monkeypatch.setattr(spa_module, "emit", lambda event_type, **f: emitted.append((event_type, f)))
    return TestClient(app), emitted


@pytest.mark.parametrize("path", ["/", "/index.html", "/samples", "/samples/", "/about"])
def test_known_routes_serve_index(client, path):
    c, _ = client
    r = c.get(path)
    assert r.status_code == 200
    assert "spa" in r.text
    assert "Content-Security-Policy" in r.headers


def test_static_file_served(client):
    c, _ = client
    r = c.get("/theme-init.js")
    assert r.status_code == 200
    assert r.text == "// js"


@pytest.mark.parametrize(
    "path",
    [
        "/wp-admin/install.php",
        "/.env",
        "/.git/config",
        "/blog/wp-includes/wlwmanifest.xml",
        "/foo",
        "/api/nope",
    ],
)
def test_unknown_paths_404(client, path):
    c, _ = client
    r = c.get(path)
    assert r.status_code == 404
    assert "spa" not in r.text


def test_page_view_only_for_known_routes(client):
    c, emitted = client
    c.get("/samples")
    c.get("/wp-admin/install.php")
    c.get("/theme-init.js")
    assert emitted == [("page_view", {"path": "/samples", "status_code": 200})]


def test_shell_gets_per_route_meta():
    rendered = render_shell(SHELL, "samples")
    meta = ROUTE_META["samples"]
    assert f"<title>{meta.title}</title>" in rendered
    assert 'href="https://www.odata-viewer.online/samples"' in rendered
    assert 'property="og:url" content="https://www.odata-viewer.online/samples"' in rendered
