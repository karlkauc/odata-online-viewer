"""Turn whatever the visitor pasted into a ``$metadata`` URL and a service root.

Accepted inputs: a service root (``https://host/odata/``), the metadata URL
itself (``…/$metadata``, also percent-encoded), either with query parameters
such as SAP's ``sap-client``, or the URL of a resource inside the service
(``…/odata/Customers``, ``…/odata/Customers(1)/Orders``): then the parents are
tried as service root, see :func:`candidate_service_urls`. ``$format`` is dropped because the metadata is
requested with an ``Accept`` header instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from app.parser.security import normalize_url

METADATA_SEGMENT = "$metadata"


def _encode(query: list[tuple[str, str]]) -> str:
    # quote (not quote_plus): OData servers expect %20 for spaces in $filter, not '+'.
    return urlencode(query, safe="$,/:()'*@=", quote_via=quote)


@dataclass(frozen=True)
class ServiceUrls:
    metadata_url: str
    service_root: str
    """Service root with a trailing slash and the retained query string, if any."""


def _strip_metadata(path: str) -> tuple[str, bool]:
    stripped = path.rstrip("/")
    for suffix in ("/" + METADATA_SEGMENT, "/%24metadata", "/%24METADATA"):
        if stripped.endswith(suffix):
            return stripped[: -len(suffix)], True
    return stripped, False


def split_service_url(url: str) -> ServiceUrls:
    """Derive both URLs from one input. Raises ``ValueError`` on garbage."""
    url = normalize_url(url)
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError(
            "Enter the URL of an OData service, for example "
            "https://services.odata.org/V4/Northwind/Northwind.svc/"
        )
    base_path, _ = _strip_metadata(parts.path or "")
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k.lower() != "$format"]
    query_string = _encode(query)
    root = urlunsplit((parts.scheme, parts.netloc, base_path + "/", query_string, ""))
    metadata = urlunsplit((parts.scheme, parts.netloc, base_path + "/" + METADATA_SEGMENT, query_string, ""))
    return ServiceUrls(metadata_url=metadata, service_root=root)


MAX_PARENT_TRIES = 4
"""How many trailing path segments may be dropped to find the service root."""


def candidate_service_urls(url: str) -> list[ServiceUrls]:
    """The input as service root first, then its parents (``…/odata/Customers`` →
    ``…/odata/``). An explicit ``$metadata`` URL has no alternatives."""
    first = split_service_url(url)
    parts = urlsplit(normalize_url(url))
    _, explicit = _strip_metadata(parts.path or "")
    if explicit:
        return [first]
    out = [first]
    root = urlsplit(first.service_root)
    segments = [s for s in root.path.split("/") if s]
    for _ in range(MAX_PARENT_TRIES):
        if not segments:
            break
        segments = segments[:-1]
        base = "/" + "/".join(segments) if segments else ""
        metadata = urlunsplit((root.scheme, root.netloc, base + "/" + METADATA_SEGMENT, root.query, ""))
        service_root = urlunsplit((root.scheme, root.netloc, base + "/", root.query, ""))
        out.append(ServiceUrls(metadata_url=metadata, service_root=service_root))
    return out


def service_root_from_metadata_url(metadata_url: str) -> str:
    """The root that belongs to a metadata URL *after* redirects (TripPin's
    session segment must stay in it)."""
    parts = urlsplit(metadata_url)
    base_path, _ = _strip_metadata(parts.path or "")
    return urlunsplit((parts.scheme, parts.netloc, base_path + "/", parts.query, ""))


def join_service_path(
    service_root: str, resource_path: str, query: list[tuple[str, str]] | None = None
) -> str:
    """``service_root`` + ``resource_path`` (e.g. ``Products`` or ``Products(1)/Category``)
    with the root's query parameters (``sap-client``) merged in front of ``query``."""
    root = urlsplit(service_root)
    base_query = parse_qsl(root.query, keep_blank_values=True)
    path = root.path.rstrip("/") + "/" + quote(resource_path.lstrip("/"), safe="/()',:=$@;")
    merged = base_query + list(query or [])
    return urlunsplit((root.scheme, root.netloc, path, _encode(merged), ""))


def same_service(service_root: str, url: str) -> bool:
    """True when ``url`` lives under the service root's origin and path
    (used to validate ``@odata.nextLink`` before following it)."""
    root, candidate = urlsplit(service_root), urlsplit(url)
    if (root.scheme, root.netloc.lower()) != (candidate.scheme, candidate.netloc.lower()):
        return False
    return candidate.path.startswith(root.path.rstrip("/") + "/") or candidate.path == root.path.rstrip("/")
