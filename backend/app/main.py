"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app import __version__
from app.api.data import router as data_router
from app.api.feedback import router as feedback_router
from app.api.go import router as go_router
from app.api.metadata import router as metadata_router
from app.api.samples import router as samples_router
from app.config import settings
from app.logging_setup import configure_logging, new_request_id, request_id_var
from app.rate_limit import client_ip, limiter
from app.spa import mount_spa
from app.usage.context import RequestUsage, UsageTracker, bind, unbind
from app.usage.feedback import FeedbackStore
from app.usage.geoip import GeoIp
from app.usage.recorder import UsageRecorder

configure_logging(settings.log_level)
logger = logging.getLogger("app")


class BufferRequestBodyMiddleware:
    """Drain the entire request body before the app can respond.

    Why: when the app returns an error mid-upload (e.g. a parse error after
    reading the form), uvicorn closes the upstream TCP connection without
    consuming the rest of the body. A reverse proxy still streaming the body
    upstream then delivers 502 instead of the real 4xx. Buffering the body in
    the ASGI layer makes it always fully received before any handler runs.
    """

    def __init__(self, app, buffered_methods: tuple[str, ...] = ("POST", "PUT", "PATCH")) -> None:
        self.app = app
        self.buffered_methods = buffered_methods

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope.get("method") not in self.buffered_methods:
            await self.app(scope, receive, send)
            return

        # The handlers check the upload size only after this buffer is complete;
        # stop keeping chunks past the limit so a huge body cannot fill memory.
        # The rest is still drained (see above) and then answered with 413.
        limit = settings.max_upload_bytes * 3 // 2 + 1024 * 1024  # JSON escaping, multipart framing
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] == "http.request":
                body = message.get("body")
                if body:
                    size += len(body)
                    if size <= limit:
                        chunks.append(body)
                    else:
                        chunks.clear()
                if not message.get("more_body", False):
                    break
        if size > limit:
            response = JSONResponse(
                {"detail": f"request exceeds the {settings.max_upload_mb} MB upload limit"}, status_code=413
            )
            await response(scope, receive, send)
            return

        buffered = b"".join(chunks)
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": buffered, "more_body": False}
            return {"type": "http.disconnect"}

        await self.app(scope, replay, send)


def build_usage_tracker() -> UsageTracker:
    """Usage statistics — inert unless USAGE_DB_URL is set (docs/USAGE_STATS.md)."""
    recorder = UsageRecorder(settings.usage_db_url, settings.usage_db_password)
    geoip = GeoIp(settings.geoip_db_path, settings.maxmind_license_key) if recorder.enabled else None
    if recorder.enabled and not settings.usage_hash_secret:
        logger.warning("USAGE_HASH_SECRET is empty; visitor hashes are only date-salted")
    return UsageTracker(recorder, geoip, settings.usage_hash_secret)


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    tracker = build_usage_tracker()
    application.state.usage = tracker
    await tracker.start()
    try:
        yield
    finally:
        await tracker.stop()


app = FastAPI(
    title="OData Online Viewer",
    version=__version__,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.state.limiter = limiter
# Module level (not in lifespan): tests use TestClient(app) without a context
# manager, and the feedback store has no start/stop lifecycle anyway.
app.state.feedback = FeedbackStore(settings.feedback_db_url, settings.feedback_db_password)


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_exceeded(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"error": "rate_limit_exceeded", "detail": f"limit: {exc.detail}"},
        headers={"Retry-After": "60"},
    )


app.add_middleware(SlowAPIMiddleware)
app.add_middleware(BufferRequestBodyMiddleware)
# Cloud Run rejects non-streamed responses above 32 MiB; a large SAP service's
# model JSON is highly repetitive and compresses well. Responses carry no
# per-user secrets, so BREACH-style attacks on compressed bodies are not a concern.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)

# Same-origin deployment: the SPA is served from the same host as the API.
# Set CORS_ALLOW_ORIGINS only if a foreign frontend should call the API.
if settings.cors_allow_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_allow_origins),
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Accept"],
    )


# Security headers on every response. On Cloud Run there is no reverse proxy to
# add these, so the app must. The SPA shell sets its own CSP (see app.spa);
# setdefault preserves those more specific values for API/static responses.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    # sandbox: a document an API route echoes (sample XML, metadata source) must
    # never run script or submit forms on this origin, even when opened directly.
    response.headers.setdefault(
        "Content-Security-Policy", "default-src 'none'; form-action 'none'; frame-ancestors 'none'; sandbox"
    )
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    # Credentials travel in request bodies; make sure no intermediary caches answers.
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.middleware("http")
async def request_logging(request: Request, call_next):
    rid = new_request_id()
    token = request_id_var.set(rid)
    tracker: UsageTracker | None = getattr(request.app.state, "usage", None)
    usage: RequestUsage | None = (
        RequestUsage(
            tracker=tracker,
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
            referrer=request.headers.get("referer"),
        )
        if tracker is not None
        else None
    )
    usage_token = bind(usage)
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request failed",
            extra={"ctx_method": request.method, "ctx_path": request.url.path},
        )
        return JSONResponse(
            status_code=500,
            content={"error": "internal_error", "request_id": rid},
        )
    finally:
        request_id_var.reset(token)
        unbind(usage_token)
    if usage is not None and usage.emitted:
        # Cloud Run throttles CPU after the response; give the writer a bounded
        # chance to finish while we still have it (see docs/USAGE_STATS.md).
        await usage.tracker.recorder.drain(timeout=settings.usage_drain_seconds)
    duration_ms = round((time.perf_counter() - start) * 1000, 2)
    logger.info(
        "request completed",
        extra={
            "ctx_method": request.method,
            "ctx_path": request.url.path,
            "ctx_status": response.status_code,
            "ctx_duration_ms": duration_ms,
        },
    )
    response.headers["X-Request-ID"] = rid
    return response


# The bare domain is mapped to the same Cloud Run service; send it to the
# canonical www origin so visitors, links and the usage stats see one host.
# Registered last, so it runs before body buffering and usage tracking.
_site = urlsplit(settings.site_origin)
_apex_host = _site.hostname[4:] if _site.hostname and _site.hostname.startswith("www.") else None


@app.middleware("http")
async def redirect_apex_to_www(request: Request, call_next):
    if _apex_host and request.headers.get("host", "").lower() == _apex_host:
        target = settings.site_origin + request.url.path
        if request.url.query:
            target += "?" + request.url.query
        # 308 keeps method and body for API calls; plain page loads get the classic 301.
        status = 301 if request.method in ("GET", "HEAD") else 308
        return RedirectResponse(target, status_code=status)
    return await call_next(request)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


app.include_router(metadata_router, prefix="/api")
app.include_router(data_router, prefix="/api")
app.include_router(samples_router, prefix="/api")
app.include_router(feedback_router, prefix="/api")
app.include_router(go_router)  # /go/… redirects, registered before the SPA catch-all

# --- Static frontend ------------------------------------------------------
# In dev, the Vite dev-server runs separately and proxies /api; in production
# the Docker image copies the built assets to settings.static_dir.
_static_path = Path(settings.static_dir)
if _static_path.is_dir() and (_static_path / "index.html").is_file():
    mount_spa(app, _static_path)
else:
    logger.info(
        "static assets not found; API-only mode",
        extra={"ctx_static_dir": str(_static_path)},
    )
