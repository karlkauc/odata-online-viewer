"""Serve the built SPA: static assets plus the HTML shell for known client routes.

The shell is returned only for paths the frontend actually handles. Everything
else gets a plain 404, so vulnerability scanners probing /wp-login.php & co.
neither receive a 200 nor pollute the usage stats with fake page views.

Search engines see the shell before any JavaScript runs, so title,
description and canonical are rewritten per route in the served HTML.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.usage.context import emit


@dataclass(frozen=True)
class RouteMeta:
    title: str
    description: str
    canonical: str


_HOME_DESCRIPTION = (
    "Free online OData visualizer: load an OData service URL or its $metadata (V2, V3, V4) and "
    "explore entity sets, entity types, properties and relationships as a tree, entity-relationship "
    "diagram or source. Query entity sets live, with Basic Auth if needed."
)

# Keep in sync with the client routes in frontend/src/App.tsx. Deep links to
# model nodes use the URL hash, which never reaches the server.
ROUTE_META: dict[str, RouteMeta] = {
    "": RouteMeta("Online OData Viewer — visualize $metadata, explore entity sets", _HOME_DESCRIPTION, "/"),
    "samples": RouteMeta(
        "Sample OData services — Online OData Viewer",
        "Open Northwind (V2/V4), TripPin and other public OData services in the viewer: browse their "
        "metadata, diagrams and data without entering a URL.",
        "/samples",
    ),
    "about": RouteMeta(
        "About — Online OData Viewer",
        "What the OData viewer does with your metadata and credentials, which OData versions it reads, "
        "and how it relates to the XSD and XML viewers by the same author.",
        "/about",
    ),
}

SPA_ROUTES: frozenset[str] = frozenset(ROUTE_META)

_TITLE_RE = re.compile(r"<title>.*?</title>", re.S)
_DESCRIPTION_RE = re.compile(r'(<meta\s+name="description"\s+content=")[^"]*(")', re.S)
_CANONICAL_RE = re.compile(r'(<link\s+rel="canonical"\s+href=")[^"]*(")', re.S)
_OG_RE = {
    key: re.compile(rf'(<meta\s+property="og:{key}"\s+content=")[^"]*(")', re.S)
    for key in ("title", "description", "url")
}


def render_shell(shell: str, route: str) -> str:
    """Return the index.html shell with title/description/canonical/OG for ``route``."""
    meta = ROUTE_META[route.rstrip("/")]
    canonical = settings.site_origin + meta.canonical
    title, description = html.escape(meta.title), html.escape(meta.description)
    shell = _TITLE_RE.sub(f"<title>{title}</title>", shell, count=1)
    shell = _DESCRIPTION_RE.sub(rf"\g<1>{description}\g<2>", shell, count=1)
    shell = _CANONICAL_RE.sub(rf"\g<1>{canonical}\g<2>", shell, count=1)
    for key, value in (("title", title), ("description", description), ("url", canonical)):
        shell = _OG_RE[key].sub(rf"\g<1>{value}\g<2>", shell, count=1)
    return shell


CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "worker-src 'self' blob:; "
    "connect-src 'self'"
)

SPA_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


def is_spa_route(full_path: str) -> bool:
    """True if the path (without leading slash) is a client-side route; a trailing slash is tolerated."""
    return full_path.rstrip("/") in SPA_ROUTES


def mount_spa(app: FastAPI, static_path: Path) -> None:
    """Serve the built React SPA from ``static_path`` (must contain index.html)."""
    app.mount("/assets", StaticFiles(directory=static_path / "assets"), name="assets")
    static_root = static_path.resolve()
    index_file = static_path / "index.html"

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> Response:
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"error": "not_found"})
        # Root-level static files (favicon.svg, robots.txt, sitemap.xml, …)
        # are served directly; guarded against path traversal.
        if full_path and full_path != "index.html":
            candidate = (static_root / full_path).resolve()
            if static_root in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
        route = "" if full_path == "index.html" else full_path.rstrip("/")
        if not is_spa_route(route):
            return JSONResponse(status_code=404, content={"error": "not_found"})
        emit("page_view", path="/" + route, status_code=200)
        return Response(
            content=render_shell(index_file.read_text(encoding="utf-8"), route),
            media_type="text/html",
            headers=SPA_HEADERS,
        )
