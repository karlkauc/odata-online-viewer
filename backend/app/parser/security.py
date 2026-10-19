"""Security-critical parser and network helpers.

Every ``lxml`` call goes through :func:`make_parser` so that external
entities, DTD loading and network access at parse-time are globally off.
URL fetching goes through :func:`fetch_url`, which restricts schemes to
http(s), blocks private IP ranges, caps response size and limits redirects.
Hosts are allowed by default; setting ``ALLOWED_SCHEMA_HOSTS`` switches to a
strict whitelist (lockdown mode) for hardened deployments.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import socket
import time
from dataclasses import dataclass

import httpx
from lxml import etree

from app.config import settings

logger = logging.getLogger(__name__)


class SecurityError(ValueError):
    """Raised when an upload or URL violates security policy."""


class FetchHttpError(SecurityError):
    """The remote server answered with an HTTP error status.

    Kept separate so callers can tell "401, send credentials" from a policy
    violation; still a ``SecurityError`` for callers that do not care.
    """

    def __init__(self, message: str, status_code: int, *, www_authenticate: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.www_authenticate = www_authenticate


# ---------------------------------------------------------------------------
# Hardened lxml parser
# ---------------------------------------------------------------------------


def make_parser(*, internal_entities: bool = False) -> etree.XMLParser:
    """Return a parser configured to block XXE and external network access.

    - ``resolve_entities`` is off by default (no entity substitution ⇒ no XXE).
      It is switched on only for documents whose DOCTYPE passed
      :func:`inspect_dtd` — a bounded internal subset of literal-value
      entities, which is what the W3C xmldsig/xenc schemas ship with.
    - ``no_network=True`` forbids the parser from fetching DTDs/entities.
    - ``load_dtd=False`` never loads an external DTD subset, even when the
      DOCTYPE names one via SYSTEM/PUBLIC.
    - ``huge_tree=False`` leaves lxml's internal XML-bomb mitigations active.
    - ``remove_comments=False`` so comments are preserved for display.
    - ``collect_ids`` stays at its default: switching it off sets libxml2's
      ``XML_SKIP_IDS`` bit in ``loadsubset``, which libxml2 2.14 reads as "load
      the external DTD subset" — exactly what ``load_dtd=False`` forbids.
    """
    return etree.XMLParser(
        # "internal" never substitutes an external entity, even if inspect_dtd were fooled.
        resolve_entities="internal" if internal_entities else False,
        no_network=True,
        load_dtd=False,
        dtd_validation=False,
        attribute_defaults=False,
        huge_tree=False,
        remove_blank_text=False,
        remove_comments=False,
        recover=False,
    )


# ---------------------------------------------------------------------------
# DTD inspection (same rule as the XSD Online Viewer's ``inspect_dtd``)
# ---------------------------------------------------------------------------

DTD_HEAD_BYTES = 16 * 1024
MAX_DTD_DECLARATIONS = 32
MAX_ENTITY_VALUE_CHARS = 512

_DTD_TOKENS = (b"<!DOCTYPE", b"<!ENTITY", b"<!ATTLIST", b"<!NOTATION", b"<!ELEMENT")
_DOCTYPE_RE = re.compile(rb"<!DOCTYPE\b(?P<header>[^\[>]*)(?:\[(?P<subset>.*?)\]\s*)?>", re.S)
_DECL_RE = re.compile(rb"<!(?P<kind>ENTITY|ATTLIST)\b(?P<body>[^>]*)>", re.S)
_ENTITY_BODY_RE = re.compile(
    rb"^\s*(?:%\s+)?[A-Za-z_:][\w.:-]*\s+(?P<q>[\"'])(?P<value>[^\"']*)(?P=q)\s*$", re.S
)
_UNSAFE_IN_VALUE = re.compile(rb"[&%<]")

DTD_REJECTED_MESSAGE = (
    "DTD constructs are not allowed here (only a DOCTYPE with simple, literal-value "
    "<!ENTITY> declarations is accepted); remove the DOCTYPE and inline the entity values"
)


def _strip_comments(subset: bytes) -> bytes:
    """Drop ``<!--…-->`` from a DTD subset, but never inside a quoted literal.

    A quote-blind regex let ``<!ENTITY a "<!--"> <!ENTITY x SYSTEM …> <!ENTITY b "-->">``
    pass as one harmless entity while libxml2 saw the external one.
    """
    out = bytearray()
    quote: int | None = None
    i = 0
    while i < len(subset):
        ch = subset[i]
        if quote is None and subset.startswith(b"<!--", i):
            end = subset.find(b"-->", i + 4)
            if end < 0:
                raise SecurityError(DTD_REJECTED_MESSAGE)
            i = end + 3
            continue
        if quote is None and ch in b"\"'":
            quote = ch
        elif ch == quote:
            quote = None
        out.append(ch)
        i += 1
    if quote is not None:
        raise SecurityError(DTD_REJECTED_MESSAGE)
    return bytes(out)


def inspect_dtd(data: bytes) -> bool:
    """Return True when ``data`` carries a DOCTYPE that is safe to expand.

    Accepted: at most one DOCTYPE (with or without a PUBLIC/SYSTEM external
    id — the parser never loads it) whose internal subset contains only
    comments plus ≤ ``MAX_DTD_DECLARATIONS`` ``<!ENTITY>`` / ``<!ATTLIST>``
    declarations with literal values that reference nothing (no ``&``, ``%``
    or ``<``). That rules out XXE, billion-laughs nesting and injected
    markup while letting ordinary documents with a DOCTYPE through.

    The DOCTYPE must sit in the first ``DTD_HEAD_BYTES``; DTD markup anywhere
    else in the buffer is refused, so nothing can hide past an offset (a
    schema's includes are parsed by libxml2 itself, with entity substitution).

    Raises :class:`SecurityError` for everything else that looks like DTD
    markup; returns False when there is no DTD at all.
    """
    upper = data.upper()
    if not any(token in upper for token in _DTD_TOKENS):
        return False
    match = _DOCTYPE_RE.search(data[:DTD_HEAD_BYTES])
    if match is None:
        raise SecurityError(DTD_REJECTED_MESSAGE)
    remainder = upper[: match.start()] + upper[match.end() :]
    if any(token in remainder for token in _DTD_TOKENS):
        raise SecurityError(DTD_REJECTED_MESSAGE)
    subset = _strip_comments(match.group("subset") or b"")
    declarations = 0
    pos = 0
    for decl in _DECL_RE.finditer(subset):
        if subset[pos : decl.start()].strip():
            raise SecurityError(DTD_REJECTED_MESSAGE)
        pos = decl.end()
        declarations += 1
        body = decl.group("body")
        if decl.group("kind") == b"ENTITY":
            entity = _ENTITY_BODY_RE.match(body)
            if entity is None or len(entity.group("value")) > MAX_ENTITY_VALUE_CHARS:
                raise SecurityError(DTD_REJECTED_MESSAGE)
            body = entity.group("value")
        if _UNSAFE_IN_VALUE.search(body):
            raise SecurityError(DTD_REJECTED_MESSAGE)
    if subset[pos:].strip() or declarations > MAX_DTD_DECLARATIONS:
        raise SecurityError(DTD_REJECTED_MESSAGE)
    return True


# ---------------------------------------------------------------------------
# SSRF-protected URL fetcher
# ---------------------------------------------------------------------------


@dataclass
class FetchedResource:
    url: str
    content: bytes
    content_type: str | None
    status_code: int = 200
    headers: dict[str, str] | None = None


def _host_is_allowed(host: str) -> bool:
    # Empty allowlist means "any host permitted" (default-open). Setting
    # ALLOWED_SCHEMA_HOSTS turns this into a strict lockdown whitelist.
    if not settings.allowed_schema_hosts:
        return True
    return any(pattern.search(host) for pattern in settings.allowed_schema_hosts)


def _ip_is_private(ip_text: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_text)
    except ValueError:
        return True  # treat unparseable as unsafe
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _resolve_all_addrs(host: str) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise SecurityError(f"DNS resolution failed for {host!r}: {exc}") from exc
    return list({info[4][0] for info in infos})


# "www.example.org/x.xml" — an address copied without its scheme. Anything with
# an explicit scheme (ftp:, file:, mailto:) is left alone so ``_verify_url``
# rejects it with the usual "only http(s)" message; "host:8443/x" is a port,
# not a scheme.
_HAS_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:(?!\d+(?:[/?#]|$))")
_BARE_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(?::\d+)?(?:[/?#]|$)")


def normalize_url(url: str) -> str:
    """Prepend ``https://`` to a bare ``host/path``; return anything else unchanged."""
    url = url.strip()
    if not _HAS_SCHEME_RE.match(url) and _BARE_HOST_RE.match(url):
        return "https://" + url
    return url


def url_origin(url: str) -> tuple[str, str, int]:
    """``(scheme, host, port)`` with the default port filled in."""
    parsed = httpx.URL(url)
    return parsed.scheme, parsed.host, parsed.port or (443 if parsed.scheme == "https" else 80)


def _verify_url(url: str) -> tuple[str, str]:
    """Validate ``url`` and return ``(host, pinned_ip)``; see :func:`_verify_url_all`."""
    host, addrs = _verify_url_all(url)
    return host, addrs[0]


def _verify_url_all(url: str) -> tuple[str, list[str]]:
    """Validate ``url`` (scheme, host allowlist, no private IPs) and return
    ``(host, pinned_ips)``. The pinned IPs are the host's currently-resolved
    public addresses, IPv4 first; the caller connects to *those* IPs so a later
    DNS rebinding cannot redirect the request to a private address (TOCTOU)."""
    parsed = httpx.URL(url)
    if parsed.scheme not in ("http", "https"):
        raise SecurityError(f"only http(s) schemes are permitted; got {parsed.scheme!r}")
    host = parsed.host
    if not host:
        raise SecurityError(f"URL has no host: {url!r}")
    if parsed.userinfo:
        raise SecurityError("URLs with a user name or password are not supported")
    if not _host_is_allowed(host):
        raise SecurityError(f"host {host!r} is not on ALLOWED_SCHEMA_HOSTS lockdown whitelist")
    addrs = _resolve_all_addrs(host)
    for addr in addrs:
        if _ip_is_private(addr):
            raise SecurityError(
                f"host {host!r} resolves to a private/loopback address ({addr}); refusing to fetch"
            )
    if not addrs:
        raise SecurityError(f"host {host!r} did not resolve to any address")
    # IPv4 first: hosts without IPv6 connectivity would otherwise fail on a
    # dual-stack target ("No route to host") although IPv4 works fine.
    addrs.sort(key=lambda a: ":" in a)
    return host, addrs


def _read_capped(response: httpx.Response, deadline: float, max_bytes: int | None = None) -> bytes:
    """Read a streamed response body, aborting once the size cap is exceeded so
    a malicious server cannot exhaust memory before the check, or at
    ``deadline`` (a server dripping bytes resets httpx's per-read timeout forever)."""
    cap = max_bytes if max_bytes is not None else settings.fetch_max_response_bytes
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_bytes():
        total += len(chunk)
        if total > cap:
            raise SecurityError(f"response exceeds {cap // (1024 * 1024)} MB cap")
        if time.monotonic() > deadline:
            raise SecurityError("the server is too slow; giving up")
        chunks.append(chunk)
    return b"".join(chunks)


def fetch_url(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float | None = None,
    max_bytes: int | None = None,
) -> FetchedResource:
    """Fetch a document by URL, enforcing all SSRF mitigations: scheme/host
    checks, private-IP block, connection pinned to a validated IP (DNS-rebinding
    safe), redirect cap with re-validation, and a streamed response-size cap.

    ``headers`` are sent with every hop (``Accept``, ``Authorization``); the
    ``Host`` header is always derived from the URL. An ``Authorization`` header
    is only ever sent over https and is dropped when a redirect changes the
    origin (scheme, host or port) — https→http on the same host included.
    """
    remaining_redirects = settings.fetch_max_redirects
    current = normalize_url(url)
    deadline = time.monotonic() + settings.fetch_deadline_seconds
    extra = dict(headers or {})
    if "Authorization" in extra and httpx.URL(current).scheme != "https":
        raise SecurityError("credentials are only sent over https; use an https:// URL")
    first_origin = url_origin(current)
    with httpx.Client(
        follow_redirects=False,
        timeout=timeout if timeout is not None else settings.fetch_timeout_seconds,
        limits=httpx.Limits(max_connections=4),
    ) as client:
        while True:
            host, pinned_ips = _verify_url_all(current)
            parsed = httpx.URL(current)
            hop_headers = dict(extra)
            if url_origin(current) != first_origin:
                hop_headers.pop("Authorization", None)
            hop_headers["Host"] = parsed.netloc.decode("ascii")
            # Connect to the pre-validated IPs (next one on a connect failure,
            # like a browser's happy eyeballs), but keep the original Host
            # header and use the hostname for TLS SNI / certificate verification.
            stream = None
            for i, pinned_ip in enumerate(pinned_ips):
                target = parsed.copy_with(host=pinned_ip)
                try:
                    stream = client.stream(
                        "GET", target, headers=hop_headers, extensions={"sni_hostname": host}
                    )
                    response_cm = stream.__enter__()
                    break
                except httpx.ConnectError:
                    if i == len(pinned_ips) - 1:
                        raise
            assert stream is not None
            try:
                response = response_cm
                if response.is_redirect:
                    if remaining_redirects <= 0:
                        raise SecurityError("too many HTTP redirects")
                    remaining_redirects -= 1
                    location = response.headers.get("location")
                    if not location:
                        raise SecurityError("redirect without Location header")
                    current = str(httpx.URL(current).join(location))
                    continue
                if response.status_code >= 400:
                    raise FetchHttpError(
                        f"fetching {host!r} failed with HTTP {response.status_code}",
                        response.status_code,
                        www_authenticate=response.headers.get("www-authenticate"),
                    )
                content = _read_capped(response, deadline, max_bytes)
                content_type = response.headers.get("content-type")
                response_headers = {k.lower(): v for k, v in response.headers.items()}
            finally:
                stream.__exit__(None, None, None)
            logger.info(
                "fetched remote resource",
                extra={
                    "ctx_host": host,
                    "ctx_size_bytes": len(content),
                    "ctx_content_type": content_type,
                },
            )
            return FetchedResource(
                url=current,
                content=content,
                content_type=content_type,
                status_code=response.status_code,
                headers=response_headers,
            )
