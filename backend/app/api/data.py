"""Data explorer: query entity sets of a loaded service through the backend.

The browser never talks to the OData service itself (CORS, Basic Auth). The
backend forwards one request at a time, with the visitor's credentials when
given, and normalises V2/V4 answers into one table shape.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.api._common import _ms
from app.api.metadata import get_stored
from app.config import settings
from app.odata.data_client import (
    AuthPayload,
    DataError,
    QueryOptions,
    build_query,
    check_resource_path,
    column_order,
    fetch_json,
    normalise_payload,
    resolve_path,
    validate_next_link,
)
from app.odata.model import ServiceModel
from app.odata.service_url import join_service_path
from app.odata.xlsx_export import XLSX_MEDIA_TYPE, collect_rows, property_types, to_xlsx
from app.rate_limit import DATA_EXPORT_LIMIT, DATA_LIMIT, limiter
from app.usage.context import emit
from app.usage.events import schema_display_name

router = APIRouter(tags=["data"])


class QueryPayload(BaseModel):
    metadata_id: str = Field(..., min_length=8, max_length=64)
    entity_set: str = Field(..., min_length=1, max_length=512, description="Entity set name or resource path")
    options: QueryOptions = Field(default_factory=QueryOptions)
    next_link: str | None = Field(default=None, max_length=4096)
    auth: AuthPayload | None = None


class RawPayload(BaseModel):
    metadata_id: str = Field(..., min_length=8, max_length=64)
    path_and_query: str = Field(..., min_length=1, max_length=4096)
    auth: AuthPayload | None = None


class ExportPayload(BaseModel):
    metadata_id: str = Field(..., min_length=8, max_length=64)
    entity_set: str = Field(..., min_length=1, max_length=512, description="Entity set name or resource path")
    scope: Literal["page", "all"]
    options: QueryOptions = Field(default_factory=QueryOptions)
    auth: AuthPayload | None = None
    columns: list[str] | None = Field(default=None, max_length=1000)
    """``scope="page"``: the table the browser shows (also drill-downs that have no URL)."""
    rows: list[dict[str, Any]] | None = Field(default=None, max_length=5000)


class QueryResponse(BaseModel):
    request_url: str
    status_code: int
    columns: list[str]
    rows: list[dict[str, Any]]
    count: int | None
    next_link: str | None
    duration_ms: int
    notices: list[str] = Field(default_factory=list)


class RawResponse(BaseModel):
    request_url: str
    status_code: int
    content_type: str | None
    body: Any
    duration_ms: int


def _set_name(entity_set: str) -> str:
    """Drill-down paths carry key values; statistics only get the entity set."""
    return entity_set.split("(")[0].split("/")[0]


def _host(model: ServiceModel) -> str | None:
    return schema_display_name("url", model.service_root)


@router.post("/data/query", response_model=QueryResponse)
@limiter.limit(DATA_LIMIT)
async def query_entity_set(request: Request, payload: QueryPayload) -> QueryResponse:
    model = get_stored(payload.metadata_id).model
    started = time.perf_counter()
    target = resolve_path(model, payload.entity_set)
    try:
        url = (
            validate_next_link(model, payload.next_link)
            if payload.next_link
            else build_query(model, payload.entity_set, payload.options, single=not target.paged)
        )
        body, status, _ctype, _dur = await run_in_threadpool(
            fetch_json,
            url,
            model,
            payload.auth,
            timeout=settings.data_timeout_seconds,
            max_bytes=settings.data_max_response_bytes,
        )
        rows, count, next_link = normalise_payload(body, model)
    except DataError as exc:
        emit(
            "data_query",
            source="next" if payload.next_link else "query",
            schema_name=_host(model),
            target_namespace=_set_name(payload.entity_set),
            duration_ms=_ms(started),
            status="error",
            status_code=exc.upstream_status or exc.status_code,
            error_detail=str(exc),
            odata_version=model.odata_version,
        )
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    notices: list[str] = []
    if len(rows) > payload.options.top:
        notices.append(
            f"The service returned {len(rows)} rows although $top={payload.options.top} was requested."
        )
    if count is None and not target.paged and not next_link:
        count = len(rows)
    columns = column_order(rows, target.type, payload.options.select, payload.options.expand)
    emit(
        "data_query",
        source="next" if payload.next_link else "query",
        schema_name=_host(model),
        target_namespace=_set_name(payload.entity_set),
        element_count=len(rows),
        duration_ms=_ms(started),
        status="ok",
        status_code=status,
        odata_version=model.odata_version,
    )
    return QueryResponse(
        request_url=url,
        status_code=status,
        columns=columns,
        rows=rows,
        count=count,
        next_link=next_link,
        duration_ms=_ms(started),
        notices=notices,
    )


def _export_filename(entity_set: str) -> str:
    base = "".join(ch if ch.isalnum() or ch in "-_." else "-" for ch in entity_set)[:60].strip("-")
    return f"{base or 'data'}-{datetime.now(UTC):%Y%m%d-%H%M}.xlsx"


@router.post("/data/export")
@limiter.limit(DATA_EXPORT_LIMIT)
async def export_entity_set(request: Request, payload: ExportPayload) -> Response:
    """The shown page or every matching row as an Excel workbook."""
    model = get_stored(payload.metadata_id).model
    started = time.perf_counter()
    source = f"xlsx_{payload.scope}"
    notices: list[str] = []
    truncated = False
    count: int | None = None
    request_url: str | None = None
    if payload.scope == "page":
        if payload.rows is None or payload.columns is None:
            raise HTTPException(status_code=422, detail="A page export needs columns and rows.")
        rows, columns = payload.rows, payload.columns
    else:
        try:
            collected = await run_in_threadpool(
                collect_rows,
                model,
                payload.entity_set,
                payload.options,
                payload.auth,
                max_rows=settings.data_export_max_rows,
                deadline_seconds=settings.data_export_deadline_seconds,
                timeout=settings.data_timeout_seconds,
                max_bytes=settings.data_max_response_bytes,
                fetch=fetch_json,
            )
        except DataError as exc:
            emit(
                "export",
                source=source,
                schema_name=_host(model),
                target_namespace=_set_name(payload.entity_set),
                duration_ms=_ms(started),
                status="error",
                status_code=exc.upstream_status or exc.status_code,
                error_detail=str(exc),
                odata_version=model.odata_version,
            )
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        rows, count, request_url = collected.rows, collected.count, collected.request_url
        truncated, notices = collected.truncated, collected.notices
        target = resolve_path(model, payload.entity_set)
        columns = column_order(rows, target.type, payload.options.select, payload.options.expand)
    options = payload.options
    info: list[tuple[str, Any]] = [
        ("Service", model.service_root),
        ("Resource path", payload.entity_set),
        ("Scope", "Shown page" if payload.scope == "page" else "All matching rows"),
        ("$filter", options.filter),
        ("$orderby", options.orderby),
        ("$select", ",".join(options.select) or None),
        ("$expand", options.expand),
        ("$search", options.search),
        ("Custom parameters", options.extra),
        ("First request", request_url),
        ("Rows exported", len(rows)),
        ("Total count", count),
        ("Complete", "no" if truncated else "yes"),
        *[("Notice", n) for n in notices],
        ("Exported at (UTC)", f"{datetime.now(UTC):%Y-%m-%d %H:%M:%S}"),
        ("Dates", "Date/time values are converted to UTC."),
    ]
    body = await run_in_threadpool(
        to_xlsx, columns, rows, types=property_types(model, payload.entity_set), info=info
    )
    emit(
        "export",
        source=source,
        schema_name=_host(model),
        target_namespace=_set_name(payload.entity_set),
        element_count=len(rows),
        duration_ms=_ms(started),
        status="ok",
        status_code=200,
        odata_version=model.odata_version,
    )
    return Response(
        content=body,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{_export_filename(payload.entity_set)}"',
            "X-Export-Rows": str(len(rows)),
            "X-Export-Truncated": "1" if truncated else "0",
        },
    )


@router.post("/data/raw", response_model=RawResponse)
@limiter.limit(DATA_LIMIT)
async def raw_request(request: Request, payload: RawPayload) -> RawResponse:
    """GET an arbitrary resource path below the service root and return the JSON as is."""
    model = get_stored(payload.metadata_id).model
    started = time.perf_counter()
    path, _, query = payload.path_and_query.lstrip("/").partition("?")
    pairs = [tuple(p.split("=", 1)) if "=" in p else (p, "") for p in query.split("&") if p]
    try:
        if not model.service_root:
            raise DataError(
                "This metadata was pasted or uploaded; load it from the service URL to browse data.", 400
            )
        check_resource_path(path)
        if not model.odata_version.startswith("4") and not any(k == "$format" for k, _ in pairs):
            pairs.append(("$format", "json"))
        url = join_service_path(model.service_root, path, [(k, v) for k, v in pairs])
        body, status, ctype, _dur = await run_in_threadpool(
            fetch_json,
            url,
            model,
            payload.auth,
            timeout=settings.data_timeout_seconds,
            max_bytes=settings.data_max_response_bytes,
        )
    except DataError as exc:
        emit(
            "data_query",
            source="raw",
            schema_name=_host(model),
            target_namespace=path.split("(")[0],
            duration_ms=_ms(started),
            status="error",
            status_code=exc.upstream_status or exc.status_code,
            error_detail=str(exc),
            odata_version=model.odata_version,
        )
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    emit(
        "data_query",
        source="raw",
        schema_name=_host(model),
        target_namespace=path.split("(")[0],
        duration_ms=_ms(started),
        status="ok",
        status_code=status,
        odata_version=model.odata_version,
    )
    return RawResponse(
        request_url=url, status_code=status, content_type=ctype, body=body, duration_ms=_ms(started)
    )
