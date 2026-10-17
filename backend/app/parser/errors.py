"""Turn parser exceptions into messages a non-expert can act on, and undo the
input defects that are safe to undo (no I/O).

Ported from the XSD Online Viewer (``online_viewer/backend/app/parser/errors.py``
and the cleanups in its ``xsd_parser.py``); keep the two in step.
"""

from __future__ import annotations

import re

from lxml import etree

# "(<string>, line 3)" for bytes, "(schema.xsd, line 3)" for a file: the line is
# already in the message itself.
_LXML_LOCATION_RE = re.compile(r"\s*\([^()]*, line \d+\)\s*$")


def _sniff_head(content: bytes, length: int = 12) -> bytes:
    head = content.lstrip(b"\xef\xbb\xbf \t\r\n")
    return head[:length]


# File types users pick by mistake. Signatures must stay within the 12 bytes
# _sniff_head keeps.
_BINARY_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (
        b"\x10\x05\x80\x03\xb4Q",
        "a Pattern Maker cross-stitch pattern (the .xsd extension is shared, the format is "
        "unrelated to XML Schema)",
    ),
    (b"PK\x03\x04", "a ZIP archive (or a .docx/.xlsx/.odt file)"),
    (b"%PDF-", "a PDF document"),
    (b"\x1f\x8b", "a gzip archive"),
    (b"\xd0\xcf\x11\xe0", "an old Microsoft Office document (.doc/.xls)"),
    (b"Rar!", "a RAR archive"),
    (b"7z\xbc\xaf\x27\x1c", "a 7-Zip archive"),
    (b"\x89PNG", "a PNG image"),
    (b"\xff\xd8\xff", "a JPEG image"),
    (b"GIF8", "a GIF image"),
)

_TEXT_CONTROL_BYTES = frozenset({0x09, 0x0A, 0x0C, 0x0D, 0x1B})


def describe_binary_format(head: bytes) -> str | None:
    """Name the file type behind a magic-byte prefix, if we recognise it."""
    return next((desc for signature, desc in _BINARY_SIGNATURES if head.startswith(signature)), None)


def is_binary(head: bytes) -> bool:
    """True when the bytes cannot be text: a NUL or a stray control byte."""
    return any(byte < 0x20 and byte not in _TEXT_CONTROL_BYTES for byte in head)


# Text copied out of the browser's rendering of an XML file: Firefox/Chrome
# prepend a "no style information" banner and mark collapsible elements with
# a leading "-".
_BROWSER_COPY_RE = re.compile(rb"^(?:This XML file|-\s*<|-\s+\w)")

BROWSER_COPY_HINT = (
    "this looks like a copy of the browser's rendered XML view (fold markers or the "
    "'This XML file does not appear to have any style information' banner), not the file "
    "itself. Open the file with 'View page source' (Ctrl+U) or download it, then paste or "
    "upload the raw XML"
)

# An HTML5 page: what a URL returns when it points at a viewer, login or error
# page around the file. XHTML (a DOCTYPE with a PUBLIC id) is XML and parses.
_HTML_HEAD_RE = re.compile(rb"^(?:\xef\xbb\xbf)?\s*<!doctype\s+html\s*>", re.IGNORECASE)

HTML_PAGE_MESSAGE = (
    "this is an HTML page, not an XML document. A URL may point at a web page around the "
    "file (a viewer, login or error page) instead of the file itself; use the link to the "
    "raw file"
)


def looks_like_html(content: bytes) -> bool:
    return _HTML_HEAD_RE.match(content) is not None


# libxml2's wording for the well-formedness errors users actually hit, with
# what to do about each. The original text stays in front: it carries the line
# and column, and it is what a search engine knows.
_SYNTAX_HINTS: tuple[tuple[str, str], ...] = (
    (
        "Extra content at the end of the document",
        "something follows the end of the root element. An XML file has exactly one root: "
        "two documents pasted together, or text after the closing tag, cause this",
    ),
    (
        "XML declaration allowed only at the start of the document",
        "the <?xml …?> line must be the very first thing in the file. Remove whatever "
        "precedes it (a comment, stray text, or another document pasted in above)",
    ),
    ("xmlParseEntityRef: no name", "a bare '&' in the text; write it as &amp;"),
    ("EntityRef: expecting ';'", "an '&' that does not start an entity; write it as &amp;"),
    (
        "attributes construct error",
        'an attribute is not written as name="value" with straight quotes. Typographic '
        "quotes pasted from a word processor or a web page cause this",
    ),
    (
        "AttValue: \" or ' expected",
        'an attribute value is not in straight quotes (name="value"). Typographic quotes '
        "pasted from a word processor or a web page cause this",
    ),
    (
        "Invalid bytes in character encoding",
        "the file's bytes do not match the encoding its <?xml … encoding=\"…\"?> line "
        "declares (UTF-8 when it declares none). Re-save the file in that encoding",
    ),
    (
        "Input is not proper UTF-8",
        "the file is not UTF-8 but does not declare another encoding. Re-save it as UTF-8, "
        'or declare the real one in the first line (<?xml version="1.0" encoding="…"?>)',
    ),
    ("Premature end of data", "the file ends before its root element is closed; it looks cut off"),
)

_UNDECLARED_PREFIX_RE = re.compile(r"Namespace prefix (\S+) (?:on|for) (\S+) is not defined")
_UNDEFINED_ENTITY_RE = re.compile(r"Entity '([^']+)' not defined")
# libxml2 names its own parser option here, which means nothing to a visitor.
_EXCESSIVE_DEPTH_RE = re.compile(r"Excessive depth in document: \d+,? use XML_PARSE_HUGE option")


def _syntax_hint(message: str) -> str | None:
    undeclared = _UNDECLARED_PREFIX_RE.search(message)
    if undeclared:
        prefix = undeclared.group(1)
        return (
            f'the prefix "{prefix}" is used but never declared. Add its xmlns:{prefix}="…" '
            "declaration to the root element"
        )
    entity = _UNDEFINED_ENTITY_RE.search(message)
    if entity:
        name = entity.group(1)
        return (
            f"&{name}; is not declared in the document. XML itself knows only &amp; &lt; &gt; "
            "&quot; and &apos;; an HTML entity such as &nbsp;, or one from an external DTD "
            "(never loaded here), must be written as the character itself or a numeric "
            "reference (&#…;)"
        )
    return next((hint for needle, hint in _SYNTAX_HINTS if needle in message), None)


def syntax_message(exc: Exception | str) -> str:
    """lxml's well-formedness message without the ``(<source>, line N)`` suffix
    and libxml2 internals, followed by a hint where we have one."""
    message = _LXML_LOCATION_RE.sub("", str(exc))
    message = _EXCESSIVE_DEPTH_RE.sub(
        "elements are nested more than 256 levels deep, which is more than this viewer accepts",
        message,
    )
    hint = _syntax_hint(message)
    return f"{message} — {hint}" if hint else message


def humanize_syntax_error(exc: etree.XMLSyntaxError, content: bytes) -> str:
    """Describe a well-formedness failure of ``content`` (the document's bytes).

    Input that does not even start with ``<`` is not XML at all; say what it
    is instead of quoting lxml's "Start tag expected".
    """
    head = _sniff_head(content)
    if not head.startswith(b"<"):
        if not head:
            return "the document is empty"
        known = describe_binary_format(head)
        if known:
            return f"not an XML file — it looks like {known}, i.e. binary data, not text"
        if _BROWSER_COPY_RE.match(_sniff_head(content, 64)):
            return BROWSER_COPY_HINT
        if is_binary(head):
            return f"not an XML file — it starts with binary data ({head!r}), not text"
        if head[:1] in (b"{", b"["):
            return f"not an XML file — it looks like JSON (it starts with {head!r} instead of '<')"
        return f"not an XML file (it starts with {head!r} instead of '<')"
    return f"XML is not well-formed: {syntax_message(exc)}"


# ---------------------------------------------------------------------------
# Cleanups applied before parsing
# ---------------------------------------------------------------------------

# Whitespace (optionally behind a UTF-8 BOM) in front of the XML declaration.
# The spec requires ``<?xml`` at byte 0, and lxml enforces that; real-world
# files frequently violate it with a stray leading newline.
_LEADING_WS_BEFORE_DECL_RE = re.compile(rb"\A(?:\xef\xbb\xbf)?\s+(?=<\?xml)")

# A Markdown code fence around the document — what a chat assistant's answer
# looks like when copied wholesale.
_FENCE_OPEN_RE = re.compile(rb"\A(?:\xef\xbb\xbf)?\s*```[A-Za-z0-9_+-]*[ \t]*\r?\n")
_FENCE_CLOSE_RE = re.compile(rb"\r?\n[ \t]*```\s*\Z")

# What the browser's own XML rendering adds when its text is copied: a banner
# above the document and a "-" in front of every collapsible element.
_BROWSER_BANNER_RE = re.compile(
    rb"\A(?:\xef\xbb\xbf)?\s*This XML file does not appear to have any style information "
    rb"associated with it\.\s*The document tree is shown below\.\s*"
)
_MARKED_ROOT_RE = re.compile(rb"\A(?:\xef\xbb\xbf)?\s*(?:<\?xml[^>]*\?>\s*)?-[ \t]*<")
_FOLD_MARKER_RE = re.compile(rb"^([ \t]*)-[ \t]*(?=<)", re.MULTILINE)
_FOLDED_NODE_RE = re.compile(rb"^[ \t]*\+[ \t]*<", re.MULTILINE)


def _strip_markdown_fence(content: bytes) -> tuple[bytes, bool]:
    opening = _FENCE_OPEN_RE.match(content)
    if opening is None:
        return content, False
    return _FENCE_CLOSE_RE.sub(b"", content[opening.end() :]), True


def _strip_browser_view(content: bytes) -> tuple[bytes, bool]:
    """Undo a copy of the browser's rendered XML view; report whether it was one.

    Only when the banner or a marker on the root element says so: a "-" at
    the start of an inner line alone can be text. A "+" marks a node that was
    collapsed when copied — its children are not in the text, so there is
    nothing to restore and the content is left for the parser to refuse.
    """
    banner = _BROWSER_BANNER_RE.match(content)
    body = content[banner.end() :] if banner else content
    if banner is None and _MARKED_ROOT_RE.match(body) is None:
        return content, False
    if _FOLDED_NODE_RE.search(body):
        return content, False
    return _FOLD_MARKER_RE.sub(rb"\1", body), True


def clean_input(content: bytes) -> tuple[bytes, list[str]]:
    """Remove wrappers around an XML document that are safe to remove.

    Returns the (possibly unchanged) bytes and one notice per repair, so the
    visitor learns that what they see is not byte-for-byte what they sent.
    """
    notices: list[str] = []
    content, fenced = _strip_markdown_fence(content)
    if fenced:
        notices.append(
            "A Markdown code fence (```) around the content was removed. Paste the XML "
            "itself, not the code block it came in."
        )
    content, browser_copy = _strip_browser_view(content)
    if browser_copy:
        notices.append(
            "This is a copy of the browser's rendered XML view; its banner and fold markers "
            "('-') were removed. 'View page source' (Ctrl+U) shows the file itself."
        )
    match = _LEADING_WS_BEFORE_DECL_RE.match(content)
    if match is not None:
        content = content[match.end() :]
        notices.append(
            "Leading whitespace before the XML declaration was removed. The XML "
            "specification requires '<?xml' at the very start of the file; strict parsers "
            "reject this document as-is."
        )
    return content, notices


_ENCODING_DECLARATION = re.compile(r"""^(﻿?\s*<\?xml[^>]*?\sencoding\s*=\s*)(["'])[^"']*\2""")


def utf8_bytes(content: str) -> bytes:
    """``content`` as UTF-8, under an XML declaration that says so.

    Pasted text arrives as a string, so whatever encoding its declaration
    names (UTF-16, ISO-8859-1) no longer describes the bytes we hand to lxml.
    """
    return _ENCODING_DECLARATION.sub(r"\1\2UTF-8\2", content, count=1).encode("utf-8")
