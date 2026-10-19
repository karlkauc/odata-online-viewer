"""Load and retrieve OData metadata documents."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass

from fastapi import APIRouter, HTTPException, Request, UploadFile
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, Field

from app.api._common import _ms, read_upload, reject, reject_oversized_text
from app.cache import metadata_cache
from app.config import settings
from app.odata.csdl_parser import MetadataError, parse_metadata
from app.odata.data_client import AuthPayload, basic_auth_header
from app.odata.exports import to_markdown, to_mermaid
from app.odata.model import ServiceModel
from app.odata.service_url import candidate_service_urls, service_root_from_metadata_url
from app.parser.errors import clean_input, utf8_bytes
from app.parser.security import FetchHttpError, SecurityError, fetch_url, url_origin
from app.rate_limit import READ_LIMIT, WRITE_LIMIT, limiter
from app.usage.context import emit
from app.usage.events import schema_display_name

logger = logging.getLogger(__name__)

router = APIRouter(tags=["metadata"])

NOT_FOUND = "Metadata not found or expired"


@dataclass
class StoredMetadata:
    model: ServiceModel
    text: str


class TextPayload(BaseModel):
    filename: str = Field(default="metadata.xml", max_length=255)
    content: str = Field(..., description="CSDL XML or JSON")


class UrlPayload(BaseModel):
    url: str = Field(..., max_length=2048, description="Service root or $metadata URL")
    auth: AuthPayload | None = None


def _first_namespace(model: ServiceModel) -> str | None:
    return model.schemas[0].namespace if model.schemas else None


def _store(model: ServiceModel, text: str, *, key_extra: str = "") -> ServiceModel:
    digest = hashlib.sha256(text.encode("utf-8") + key_extra.encode("utf-8")).hexdigest()[:32]
    model.metadata_id = digest
    metadata_cache.put(digest, StoredMetadata(model=model, text=text))
    return model


def _parse_and_store(
    data: bytes,
    *,
    filename: str,
    source: str,
    content_type: str | None = None,
    metadata_url: str | None = None,
    service_root: str | None = None,
    auth_used: bool = False,
    notices: list[str] | None = None,
) -> ServiceModel:
    started = time.perf_counter()
    # For URL loads ``filename`` is the requested $metadata URL (no session segments from redirects).
    name = schema_display_name("url" if source in ("url", "sample") else source, filename)
    cleaned, repairs = clean_input(data)
    try:
        parsed = parse_metadata(cleaned, content_type=content_type)
    except (MetadataError, SecurityError) as exc:
        detail = str(exc)
        emit(
            "metadata_load",
            source=source,
            schema_name=name,
            input_bytes=len(data),
            duration_ms=_ms(started),
            status="parse_error",
            status_code=400,
            error_detail=detail,
        )
        raise HTTPException(status_code=400, detail=detail) from exc
    model = parsed.model
    model.filename = filename
    model.source = source
    model.metadata_url = metadata_url
    model.service_root = service_root
    model.auth_used = auth_used
    model.notices = list(notices or []) + repairs + model.notices
    _store(model, parsed.text, key_extra=service_root or "")
    emit(
        "metadata_load",
        source=source,
        schema_name=name,
        target_namespace=_first_namespace(model),
        input_bytes=len(data),
        file_count=1,
        element_count=model.stats.entity_type_count,
        type_count=model.stats.complex_type_count + model.stats.enum_type_count,
        duration_ms=_ms(started),
        status="ok",
        status_code=200,
        odata_version=model.odata_version,
    )
    logger.info(
        "metadata parsed",
        extra={
            "ctx_metadata_id": model.metadata_id,
            "ctx_version": model.odata_version,
            "ctx_entity_types": model.stats.entity_type_count,
        },
    )
    return model


def load_from_url(url: str, auth: AuthPayload | None, *, source: str = "url") -> ServiceModel:
    """Fetch ``$metadata`` for a service URL (shared by the URL loader and the samples).

    A URL that points into the service (``…/odata/Customers``) yields 400/404 for
    ``…/Customers/$metadata``; then the parent paths are tried and the first one
    that answers with a metadata document wins (with a notice)."""
    try:
        candidates = candidate_service_urls(url)
    except ValueError as exc:
        raise reject(
            "metadata_load", source, 400, str(exc), schema_name=schema_display_name("url", url)
        ) from exc
    urls = candidates[0]
    headers = {"Accept": "application/xml, application/json;q=0.9, */*;q=0.1"}
    headers.update(basic_auth_header(auth))
    fetched = None
    first_error: FetchHttpError | None = None
    for candidate in candidates:
        try:
            result = fetch_url(candidate.metadata_url, headers=headers)
        except FetchHttpError as exc:
            if exc.status_code in (400, 404, 405) and candidate is not candidates[-1]:
                first_error = first_error or exc
                continue  # maybe a resource path: try the parent
            if first_error is not None and exc.status_code in (400, 404, 405):
                exc = first_error
            detail = _describe_http_error(exc, urls.metadata_url, auth is not None)
            raise reject(
                "metadata_load",
                source,
                401 if exc.status_code in (401, 403) else 400,
                detail,
                schema_name=schema_display_name("url", urls.metadata_url),
            ) from exc
        except SecurityError as exc:
            name = schema_display_name("url", urls.metadata_url)
            raise reject("metadata_load", source, 400, str(exc), schema_name=name) from exc
        except Exception as exc:  # httpx transport errors: DNS, TLS, timeouts
            detail = f"The service could not be reached: {exc.__class__.__name__}: {exc}"
            name = schema_display_name("url", urls.metadata_url)
            raise reject("metadata_load", source, 400, detail, schema_name=name) from exc
        if candidate is candidates[0] or _looks_like_metadata(result.content):
            fetched, urls = result, candidate
            break
        first_error = first_error or FetchHttpError("not metadata", 404)
    if fetched is None:  # only parents answered, none with metadata
        exc = first_error or FetchHttpError("not metadata", 404)
        raise reject(
            "metadata_load",
            source,
            400,
            _describe_http_error(exc, candidates[0].metadata_url, auth is not None),
            schema_name=schema_display_name("url", candidates[0].metadata_url),
        )
    if auth is not None and url_origin(fetched.url) != url_origin(urls.metadata_url):
        # The data explorer would send the credentials to the new origin; the
        # visitor entered them for the URL they typed.
        raise reject(
            "metadata_load",
            source,
            400,
            f"The service redirected to {_origin_text(fetched.url)}; credentials are only used for "
            f"{_origin_text(urls.metadata_url)}. Enter the final service URL instead.",
            schema_name=schema_display_name("url", urls.metadata_url),
        )
    notices = []
    if urls is not candidates[0]:
        notices.append(
            f"The URL points into the service; loaded the metadata of the service root {urls.service_root}."
        )
    return _parse_and_store(
        fetched.content,
        filename=urls.metadata_url,
        source=source,
        content_type=fetched.content_type,
        metadata_url=fetched.url,
        service_root=service_root_from_metadata_url(fetched.url),
        auth_used=auth is not None,
        notices=notices,
    )


def _origin_text(url: str) -> str:
    scheme, host, port = url_origin(url)
    return f"{scheme}://{host}" + ("" if port in (80, 443) else f":{port}")


def _looks_like_metadata(content: bytes) -> bool:
    head = content[:4096].lstrip()
    return (head.startswith(b"<") and b"Edmx" in head) or (head.startswith(b"{") and b"$Version" in head)


def _describe_http_error(exc: FetchHttpError, url: str, had_auth: bool) -> str:
    if exc.status_code == 401:
        if had_auth:
            return "The service rejected the user name or password (HTTP 401)."
        realm = f" ({exc.www_authenticate})" if exc.www_authenticate else ""
        return f"The service requires authentication (HTTP 401){realm}. Enter a user name and password."
    if exc.status_code == 403:
        return "The service refused access to its metadata (HTTP 403)."
    if exc.status_code == 404:
        return (
            "No $metadata document at this URL (HTTP 404). "
            "Check that the URL is the service root, not a web page."
        )
    if exc.status_code == 405:
        return "The service does not allow GET on $metadata (HTTP 405)."
    return f"Fetching $metadata failed with HTTP {exc.status_code}."


@router.post("/metadata/upload", response_model=ServiceModel)
@limiter.limit(WRITE_LIMIT)
async def upload_metadata(request: Request, file: UploadFile) -> ServiceModel:
    content = await read_upload(file, event_type="metadata_load")
    # Parsing and fetching run off the event loop: one large document or slow
    # service would otherwise stall every request of this single-process app.
    # to_thread copies the ContextVar that ``emit`` reads.
    return await asyncio.to_thread(
        _parse_and_store, content, filename=file.filename or "metadata.xml", source="upload"
    )


@router.post("/metadata/text", response_model=ServiceModel)
@limiter.limit(WRITE_LIMIT)
async def upload_metadata_text(request: Request, payload: TextPayload) -> ServiceModel:
    stripped = payload.content.lstrip()
    data = payload.content.encode("utf-8") if stripped.startswith("{") else utf8_bytes(payload.content)
    reject_oversized_text(data, event_type="metadata_load", filename=payload.filename)
    return await asyncio.to_thread(_parse_and_store, data, filename=payload.filename, source="text")


@router.post("/metadata/url", response_model=ServiceModel)
@limiter.limit(WRITE_LIMIT)
async def upload_metadata_url(request: Request, payload: UrlPayload) -> ServiceModel:
    return await asyncio.to_thread(load_from_url, payload.url, payload.auth)


def get_stored(metadata_id: str) -> StoredMetadata:
    stored = metadata_cache.get(metadata_id)
    if stored is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return stored


@router.get("/metadata/{metadata_id}", response_model=ServiceModel)
@limiter.limit(READ_LIMIT)
async def get_metadata(request: Request, metadata_id: str) -> ServiceModel:
    return get_stored(metadata_id).model


@router.get("/metadata/{metadata_id}/source")
@limiter.limit(READ_LIMIT)
async def get_metadata_source(request: Request, metadata_id: str) -> Response:
    stored = get_stored(metadata_id)
    media = "application/json" if stored.model.format == "json" else "application/xml"
    return PlainTextResponse(stored.text, media_type=f"{media}; charset=utf-8")


@router.get("/metadata/{metadata_id}/export/{fmt}")
@limiter.limit(READ_LIMIT)
async def export_metadata(request: Request, metadata_id: str, fmt: str) -> Response:
    stored = get_stored(metadata_id)
    model = stored.model
    base = (model.service_root or model.filename or "odata-service").rstrip("/").rsplit("/", 1)[
        -1
    ] or "odata-service"
    base = "".join(ch if ch.isalnum() or ch in "-_." else "-" for ch in base)[:60] or "odata-service"
    if fmt == "markdown":
        body, media, ext = to_markdown(model), "text/markdown", "md"
    elif fmt == "mermaid":
        body, media, ext = to_mermaid(model), "text/plain", "mmd"
    elif fmt == "source":
        body = stored.text
        media, ext = ("application/json", "json") if model.format == "json" else ("application/xml", "xml")
    else:
        raise HTTPException(status_code=404, detail="unknown export format")
    emit(
        "export",
        source=fmt,
        schema_name=schema_display_name("url", model.metadata_url or model.filename),
        status="ok",
        status_code=200,
    )
    return Response(
        content=body,
        media_type=f"{media}; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{base}-metadata.{ext}"'},
    )


__all__ = ["router", "load_from_url", "get_stored", "StoredMetadata", "settings"]
