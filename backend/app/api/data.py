"""Data explorer: query entity sets of a loaded service through the backend.

The browser never talks to the OData service itself (CORS, Basic Auth). The
backend forwards one request at a time, with the visitor's credentials when
given, and normalises V2/V4 answers into one table shape.
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
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
    validate_next_link,
)
from app.odata.model import EntityType, ServiceModel
from app.odata.service_url import join_service_path
from app.rate_limit import DATA_LIMIT, limiter
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


def _entity_type_for(model: ServiceModel, entity_set: str) -> EntityType | None:
    set_name = entity_set.split("(")[0].split("/")[0]
    for schema in model.schemas:
        for container in schema.containers:
            for s in container.entity_sets:
                if s.name == set_name:
                    for sch in model.schemas:
                        for et in sch.entity_types:
                            if et.qualified_name == s.entity_type:
                                return et
    return None


def _host(model: ServiceModel) -> str | None:
    return schema_display_name("url", model.service_root)


@router.post("/data/query", response_model=QueryResponse)
@limiter.limit(DATA_LIMIT)
async def query_entity_set(request: Request, payload: QueryPayload) -> QueryResponse:
    model = get_stored(payload.metadata_id).model
    started = time.perf_counter()
    try:
        url = (
            validate_next_link(model, payload.next_link)
            if payload.next_link
            else build_query(model, payload.entity_set, payload.options)
        )
        body, status, _ctype, _dur = fetch_json(
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
            target_namespace=payload.entity_set,
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
    columns = column_order(rows, _entity_type_for(model, payload.entity_set), payload.options.select)
    emit(
        "data_query",
        source="next" if payload.next_link else "query",
        schema_name=_host(model),
        target_namespace=payload.entity_set,
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
        body, status, ctype, _dur = fetch_json(
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
