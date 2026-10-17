"""Query entity sets of a live OData service and normalise the answer.

V2 answers ``{"d": {"results": [...], "__count": "n", "__next": "…"}}`` with
``/Date(ms)/`` strings and ``__metadata``/``__deferred`` blobs; V4 answers
``{"value": [...], "@odata.count": n, "@odata.nextLink": "…"}``. Both come
out as the same :class:`QueryResult` so the explorer has one table to render.
"""

from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from pydantic import BaseModel, Field

from app.odata.model import EntityType, ServiceModel
from app.odata.service_url import join_service_path, same_service
from app.parser.security import FetchHttpError, SecurityError, fetch_url

MAX_TOP = 500
_V2_DATE_RE = re.compile(r"^/Date\((-?\d+)([+-]\d{1,4})?\)/$")
_V2_META_KEYS = ("__metadata",)


class DataError(ValueError):
    """A data request could not be made or the answer was not understood."""

    def __init__(self, message: str, status_code: int = 502, *, upstream_status: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.upstream_status = upstream_status


class AuthPayload(BaseModel):
    username: str = Field(..., min_length=1, max_length=255)
    password: str = Field(default="", max_length=1024)


def basic_auth_header(auth: AuthPayload | None) -> dict[str, str]:
    if auth is None:
        return {}
    token = base64.b64encode(f"{auth.username}:{auth.password}".encode()).decode("ascii")
    return {"Authorization": f"Basic {token}"}


class QueryOptions(BaseModel):
    top: int = Field(default=50, ge=1, le=MAX_TOP)
    skip: int = Field(default=0, ge=0, le=10_000_000)
    filter: str | None = Field(default=None, max_length=4000)
    select: list[str] = Field(default_factory=list)
    orderby: str | None = Field(default=None, max_length=1000)
    expand: str | None = Field(default=None, max_length=1000)
    search: str | None = Field(default=None, max_length=1000)
    count: bool = True
    extra: str | None = Field(default=None, max_length=2000)
    """Free-form additional query string (``p_jahr=2025&…``), for parameterised services."""


@dataclass
class QueryResult:
    request_url: str
    status_code: int
    columns: list[str]
    rows: list[dict[str, Any]]
    count: int | None
    next_link: str | None
    duration_ms: int
    truncated: bool = False
    notices: list[str] = field(default_factory=list)


def build_query(model: ServiceModel, entity_set_path: str, options: QueryOptions) -> str:
    """Absolute request URL for one page of an entity set."""
    if not model.service_root:
        raise DataError(
            "This metadata was pasted or uploaded; load it from the service URL to browse data.", 400
        )
    check_resource_path(entity_set_path)
    v2 = not model.odata_version.startswith("4")
    query: list[tuple[str, str]] = []
    if options.select:
        query.append(("$select", ",".join(s.strip() for s in options.select if s.strip())))
    if options.filter and options.filter.strip():
        query.append(("$filter", options.filter.strip()))
    if options.orderby and options.orderby.strip():
        query.append(("$orderby", options.orderby.strip()))
    if options.expand and options.expand.strip():
        query.append(("$expand", options.expand.strip()))
    if options.search and options.search.strip() and not v2:
        query.append(("$search", options.search.strip()))
    query.append(("$top", str(options.top)))
    if options.skip:
        query.append(("$skip", str(options.skip)))
    if options.count:
        query.append(("$inlinecount", "allpages") if v2 else ("$count", "true"))
    if v2:
        query.append(("$format", "json"))
    if options.extra and options.extra.strip():
        for pair in options.extra.strip().lstrip("?&").split("&"):
            if not pair:
                continue
            key, _, value = pair.partition("=")
            if key.strip():
                query.append((key.strip(), value))
    return join_service_path(model.service_root, entity_set_path, query)


def check_resource_path(path: str) -> None:
    if not path or path.startswith(("http:", "https:", "//")) or ".." in path or "\n" in path or "\r" in path:
        raise DataError("Invalid resource path.", 400)
    if path.startswith("$") and not path.startswith(("$metadata", "$batch")):
        raise DataError("Invalid resource path.", 400)
    if path in ("$metadata", "$batch"):
        raise DataError("Use the metadata loader for $metadata; $batch is not supported.", 400)


def accept_header(model: ServiceModel) -> str:
    if model.odata_version.startswith("4"):
        return (
            "application/json;odata.metadata=minimal;IEEE754Compatible=true, "
            "application/json;q=0.9, */*;q=0.1"
        )
    return "application/json;q=0.9, application/atom+xml;q=0.5, */*;q=0.1"


def fetch_json(
    url: str,
    model: ServiceModel,
    auth: AuthPayload | None,
    *,
    timeout: float,
    max_bytes: int,
) -> tuple[Any, int, str | None, int]:
    """GET ``url`` and decode JSON. Returns (payload, status, content type, duration ms)."""
    headers = {"Accept": accept_header(model)}
    if not model.odata_version.startswith("4"):
        headers["MaxDataServiceVersion"] = "2.0"
        headers["DataServiceVersion"] = "2.0"
    else:
        headers["OData-MaxVersion"] = "4.0"
    headers.update(basic_auth_header(auth))
    started = time.perf_counter()
    try:
        fetched = fetch_url(url, headers=headers, timeout=timeout, max_bytes=max_bytes)
    except FetchHttpError as exc:
        raise DataError(_describe_http_error(exc, url), 502, upstream_status=exc.status_code) from exc
    except SecurityError as exc:
        raise DataError(str(exc), 400) from exc
    except Exception as exc:  # httpx transport errors
        raise DataError(f"The service could not be reached: {exc.__class__.__name__}: {exc}", 502) from exc
    duration = int((time.perf_counter() - started) * 1000)
    ctype = (fetched.content_type or "").split(";")[0].strip().lower()
    body = fetched.content
    if ctype.endswith("xml") or body.lstrip()[:1] == b"<":
        raise DataError(
            "The service answered with XML (Atom) instead of JSON. OData V2 services need $format=json; "
            "this one may not support JSON at all.",
            502,
            upstream_status=fetched.status_code,
        )
    try:
        payload = json.loads(body.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DataError(
            f"The service did not return valid JSON ({exc}).", 502, upstream_status=fetched.status_code
        ) from exc
    return payload, fetched.status_code, fetched.content_type, duration


def _describe_http_error(exc: FetchHttpError, url: str) -> str:
    host = urlsplit(url).hostname or "the service"
    if exc.status_code == 401:
        return f"{host} requires authentication (HTTP 401). Enter a user name and password."
    if exc.status_code == 403:
        return (
            f"{host} refused the request (HTTP 403): the credentials are not allowed to read this resource."
        )
    if exc.status_code == 404:
        return f"{host} answered HTTP 404: the entity set or resource does not exist at this URL."
    if exc.status_code == 400:
        return f"{host} rejected the query (HTTP 400). Check $filter, $orderby and $select syntax."
    if exc.status_code == 501:
        return f"{host} does not implement this query option (HTTP 501)."
    return f"{host} answered HTTP {exc.status_code}."


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------


def _v2_date(value: str) -> str:
    match = _V2_DATE_RE.match(value)
    if not match:
        return value
    millis = int(match.group(1))
    offset = match.group(2)
    try:
        moment = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=millis)
    except OverflowError:
        return value
    if offset:
        sign = -1 if offset.startswith("-") else 1
        minutes = int(offset[1:])
        moment = moment + timedelta(minutes=sign * minutes)
        return (
            moment.replace(tzinfo=None).isoformat(timespec="milliseconds")
            + f"{offset[0]}{minutes // 60:02d}:{minutes % 60:02d}"
        )
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _clean_v2(value: Any) -> Any:
    if isinstance(value, str):
        return _v2_date(value) if value.startswith("/Date(") else value
    if isinstance(value, dict):
        if "__deferred" in value:
            uri = value["__deferred"].get("uri") if isinstance(value["__deferred"], dict) else None
            return {"@link": uri} if uri else {"@deferred": True}
        if (
            "results" in value
            and isinstance(value["results"], list)
            and set(value) <= {"results", "__count", "__next"}
        ):
            return [_clean_v2(item) for item in value["results"]]
        return {k: _clean_v2(v) for k, v in value.items() if k not in _V2_META_KEYS}
    if isinstance(value, list):
        return [_clean_v2(v) for v in value]
    return value


def normalise_payload(
    payload: Any, model: ServiceModel
) -> tuple[list[dict[str, Any]], int | None, str | None]:
    """Rows, inline count and next link from a V2 or V4 JSON body."""
    if not isinstance(payload, dict):
        raise DataError("Unexpected JSON shape: expected an object.", 502)
    if "error" in payload and isinstance(payload["error"], dict):
        message = payload["error"].get("message")
        if isinstance(message, dict):
            message = message.get("value")
        raise DataError(f"The service reported an error: {message or payload['error']}", 502)
    if "d" in payload:  # V2 / V3 verbose JSON
        d = payload["d"]
        count = next_link = None
        if isinstance(d, dict) and "results" in d:
            count, next_link = d.get("__count"), d.get("__next")
            rows = d["results"]
        elif isinstance(d, list):
            rows = d
        else:
            rows = [d]
        try:
            count_int = int(count) if count is not None else None
        except (TypeError, ValueError):
            count_int = None
        cleaned = [_clean_v2(r) for r in rows if isinstance(r, dict)]
        return cleaned, count_int, next_link
    if "value" in payload and isinstance(payload["value"], list):
        rows = [r if isinstance(r, dict) else {"value": r} for r in payload["value"]]
        count = payload.get("@odata.count")
        next_link = payload.get("@odata.nextLink")
        return (
            rows,
            (int(count) if isinstance(count, (int, float, str)) and str(count).isdigit() else None),
            next_link,
        )
    # A single entity or a primitive wrapper.
    if "value" in payload and len([k for k in payload if not k.startswith("@")]) == 1:
        return [{"value": payload["value"]}], None, None
    return [{k: v for k, v in payload.items() if not k.startswith("@odata.context")}], None, None


def expand_names(expand: str | None) -> list[str]:
    """Top-level navigation names of an ``$expand`` value: ``Kunde($select=Name),Produkt`` → ``[Kunde, Produkt]``."""
    if not expand:
        return []
    names, depth, current = [], 0, ""
    for ch in expand:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            names.append(current)
            current = ""
            continue
        if depth == 0 and ch not in "()":
            current += ch
    names.append(current)
    return [n.strip().split("/")[0] for n in names if n.strip() and n.strip() != "*"]


def column_order(
    rows: list[dict[str, Any]], entity_type: EntityType | None, select: list[str], expand: str | None = None
) -> list[str]:
    """Columns: the selected properties, else the entity type's declared order,
    then whatever else the rows carry (open types, expands, annotations)."""
    seen: list[str] = []

    def add(name: str) -> None:
        if name not in seen:
            seen.append(name)

    if select:
        for s in select:
            add(s.strip())
    elif entity_type is not None:
        for p in entity_type.properties:
            add(p.name)
    for row in rows:
        for key in row:
            if key.startswith("@odata.") or key.startswith("__"):
                continue
            add(key)
    expanded = expand_names(expand)
    if expand and expand.strip() == "*" and entity_type is not None:
        expanded = [n.name for n in entity_type.navigation_properties]
    for name in expanded:
        add(name)
    if select:
        return [c for c in seen if c in select or c in expanded]
    return [c for c in seen if any(c in row for row in rows)] or seen


def validate_next_link(model: ServiceModel, next_link: str) -> str:
    if not model.service_root:
        raise DataError("No service root known for this metadata.", 400)
    if not next_link.startswith(("http://", "https://")):
        next_link = (
            join_service_path(model.service_root, next_link.lstrip("/"))
            if "?" not in next_link
            else (model.service_root.rstrip("/") + "/" + next_link.lstrip("/"))
        )
    if not same_service(model.service_root, next_link):
        raise DataError("The next link points outside the service; refusing to follow it.", 400)
    return next_link
