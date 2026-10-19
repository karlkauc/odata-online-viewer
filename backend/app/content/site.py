"""Per-site constants for the content pages; the rest of ``app.content`` is shared with the siblings."""

from __future__ import annotations

SITE_NAME = "Online OData Viewer"
# Where the "Open the viewer" button in the page header points.
VIEWER_PATH = "/"
LOGO_PATH = "/favicon.svg"
# This site's key in FAMILY; its own entry is shown without a link.
SELF = "odata"

# Same list, same order on all three viewers. Sister links go through /go/
# so clicks are counted without client-side tracking.
FAMILY: tuple[tuple[str, str, str], ...] = (
    ("xsd", "XSD Viewer", "/go/xsd-viewer"),
    ("xml", "XML Viewer", "/go/xml-viewer"),
    ("odata", "OData Viewer", "/go/odata-viewer"),
    ("desktop", "Desktop app", "/go/freexmltoolkit"),
)

# /guides lists these sections in this order (app/content/pages.py, _hub). A prefix
# ending in "/" takes every page below it; pages in no section are not listed.
HUB_INTRO = (
    "Guides for reading OData services: SAP, Power BI and Dynamics endpoints, query options, "
    "V2 vs V4, the public sample services and how the viewer compares."
)
HUB_SECTIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Guides", ("guides/",)),
    ("By platform", ("sap", "power-bi", "dynamics")),
    ("Features", ("features/",)),
    ("Sample services", ("samples/",)),
    ("Comparisons", ("alternatives/",)),
)
