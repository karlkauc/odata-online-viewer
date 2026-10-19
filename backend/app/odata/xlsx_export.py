"""Excel export of data explorer results.

``collect_rows`` pages through a whole entity set (server-driven next links,
otherwise ``$skip``) up to a row cap and a deadline; ``to_xlsx`` writes rows
plus a sheet describing the query. Cell values are typed from the model so
V4 Decimal/Int64 strings and ISO dates arrive in Excel as numbers and dates.
"""

from __future__ import annotations

import io
import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

import xlsxwriter

from app.odata.csdl_parser import split_collection
from app.odata.data_client import (
    MAX_TOP,
    AuthPayload,
    QueryOptions,
    build_query,
    fetch_json,
    normalise_payload,
    resolve_path,
    validate_next_link,
)
from app.odata.model import ComplexType, EntityType, ServiceModel

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_EXCEL_MAX_CHARS = 32_767
# Excel keeps 15 significant digits; longer numbers stay text rather than lose precision.
_EXCEL_MAX_DIGITS = 15
_NUMERIC_TYPES = {"Edm.Decimal", "Edm.Int64", "Edm.Double", "Edm.Single"}
_DATE_TYPES = {"Edm.DateTime", "Edm.DateTimeOffset", "Edm.Date"}


@dataclass
class CollectedRows:
    request_url: str
    rows: list[dict[str, Any]]
    count: int | None
    pages: int
    truncated: bool = False
    notices: list[str] = field(default_factory=list)


def collect_rows(
    model: ServiceModel,
    entity_set: str,
    options: QueryOptions,
    auth: AuthPayload | None,
    *,
    max_rows: int,
    deadline_seconds: float,
    timeout: float,
    max_bytes: int,
    fetch: Callable[..., tuple[Any, int, str | None, int]] = fetch_json,
) -> CollectedRows:
    """All rows the query matches, starting at the user's ``$skip``.

    Stops on an empty or short page, when the inline count is reached, at
    ``max_rows`` or at the deadline (both mark the result ``truncated``)."""
    started = time.monotonic()
    single = not resolve_path(model, entity_set).collection
    page_options = options.model_copy(update={"top": MAX_TOP})
    url = build_query(model, entity_set, page_options, single=single)
    first_url = url
    rows: list[dict[str, Any]] = []
    count: int | None = None
    pages = 0
    # A service may split one $top=500 request into chunks joined by next links;
    # a request is "short" only once its last chunk arrived.
    request_started_at = 0
    first_of_previous: dict[str, Any] | None = None
    notices: list[str] = []
    while True:
        body, _status, _ctype, _dur = fetch(url, model, auth, timeout=timeout, max_bytes=max_bytes)
        page, page_count, next_link = normalise_payload(body, model)
        pages += 1
        if page_count is not None and count is None:
            count = page_count
        if single or not page:
            rows.extend(page)
            break
        if first_of_previous is not None and page[0] == first_of_previous:
            notices.append("The service ignored $skip and repeated a page; the export stops there.")
            break
        first_of_previous = page[0]
        rows.extend(page)
        if len(rows) >= max_rows:
            remaining = count - options.skip if count is not None else None
            if len(rows) > max_rows or next_link or remaining is None or remaining > max_rows:
                notices.append(
                    f"The export stopped at {max_rows:,} rows; narrow the $filter to get the rest."
                )
                rows = rows[:max_rows]
                return CollectedRows(first_url, rows, count, pages, True, notices)
            break
        if count is not None and len(rows) >= count - options.skip:
            break
        if next_link:
            url = validate_next_link(model, next_link)
        elif len(rows) - request_started_at < MAX_TOP and count is None:
            break
        else:
            request_started_at = len(rows)
            skip = options.skip + len(rows)
            url = build_query(model, entity_set, page_options.model_copy(update={"skip": skip}))
        if time.monotonic() - started > deadline_seconds:
            notices.append(
                f"The export stopped after {deadline_seconds:.0f} s with {len(rows):,} rows; "
                "the service is too slow for a complete export."
            )
            return CollectedRows(first_url, rows, count, pages, True, notices)
    return CollectedRows(first_url, rows, count, pages, False, notices)


def property_types(model: ServiceModel, entity_set: str) -> dict[str, str]:
    """Edm type per property of the type a resource path addresses, base types included."""
    target = resolve_path(model, entity_set).type
    if target is None:
        return {}
    types: dict[str, EntityType | ComplexType] = {
        t.qualified_name: t for s in model.schemas for t in [*s.entity_types, *s.complex_types]
    }
    result: dict[str, str] = {}
    current: EntityType | ComplexType | None = target
    seen: set[str] = set()
    while current is not None and current.qualified_name not in seen:
        seen.add(current.qualified_name)
        for p in current.properties:
            inner, is_collection = split_collection(p.type)
            result.setdefault(p.name, "" if is_collection else inner)
        current = types.get(current.base_type) if current.base_type else None
    return result


def _number(text: str) -> int | float | None:
    try:
        value = Decimal(text.strip())
    except InvalidOperation:
        return None
    if not value.is_finite() or len(value.as_tuple().digits) > _EXCEL_MAX_DIGITS:
        return None
    return int(value) if value == value.to_integral_value() and "." not in text else float(value)


def _date(text: str) -> datetime | None:
    """ISO date/time → naive UTC datetime (Excel has no time zones)."""
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is not None:
        moment = moment.astimezone(UTC).replace(tzinfo=None)
    return moment


def cell_value(value: Any, edm_type: str = "") -> Any:
    """What goes into one Excel cell: None, bool, number, datetime or text."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        if edm_type in _NUMERIC_TYPES:
            number = _number(value)
            if number is not None:
                return number
        elif edm_type in _DATE_TYPES:
            moment = _date(value)
            if moment is not None:
                return moment
        return value[:_EXCEL_MAX_CHARS]
    if isinstance(value, dict) and isinstance(value.get("@link"), str) and len(value) == 1:
        return value["@link"][:_EXCEL_MAX_CHARS]
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))[:_EXCEL_MAX_CHARS]


def to_xlsx(
    columns: list[str],
    rows: list[dict[str, Any]],
    *,
    types: dict[str, str],
    info: list[tuple[str, Any]],
) -> bytes:
    """Sheet "Data" with the rows, sheet "Query" with ``info`` (label, value) pairs."""
    out = io.BytesIO()
    workbook = xlsxwriter.Workbook(
        out,
        {
            "constant_memory": True,
            # Values come from a third-party service: never formulas or links.
            "strings_to_formulas": False,
            "strings_to_urls": False,
            "strings_to_numbers": False,
        },
    )
    bold = workbook.add_format({"bold": True})
    date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
    datetime_format = workbook.add_format({"num_format": "yyyy-mm-dd hh:mm:ss"})

    sheet = workbook.add_worksheet("Data")
    for c, name in enumerate(columns):
        sample = [len(str(row.get(name, ""))) for row in rows[:200]]
        sheet.set_column(c, c, min(60, max(len(name) + 2, *sample, 8) + 1))
    for c, name in enumerate(columns):
        sheet.write_string(0, c, name, bold)
    for r, row in enumerate(rows, start=1):
        for c, name in enumerate(columns):
            value = cell_value(row.get(name), types.get(name, ""))
            if value is None:
                continue
            if isinstance(value, datetime):
                fmt = date_format if types.get(name) == "Edm.Date" else datetime_format
                sheet.write_datetime(r, c, value, fmt)
            elif isinstance(value, bool):
                sheet.write_boolean(r, c, value)
            elif isinstance(value, (int, float)):
                sheet.write_number(r, c, value)
            else:
                sheet.write_string(r, c, value)
    if columns:
        sheet.freeze_panes(1, 0)
        sheet.autofilter(0, 0, max(len(rows), 1), len(columns) - 1)

    query = workbook.add_worksheet("Query")
    query.set_column(0, 0, 22)
    query.set_column(1, 1, 100)
    for r, (label, value) in enumerate(info):
        query.write_string(r, 0, label, bold)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            query.write_number(r, 1, value)
        elif value is not None:
            query.write_string(r, 1, str(value)[:_EXCEL_MAX_CHARS])
    workbook.close()
    return out.getvalue()

