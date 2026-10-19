"""One content page per bundled sample service (``/samples/<id>``), built from its metadata snapshot.

People search for "northwind odata" or "trippin odata service" and want to see what is
in it; the page answers that without JavaScript and links each entity set into the
data explorer.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

from app.content.pages import Page
from app.odata.csdl_parser import parse_metadata
from app.odata.model import EntityType, ServiceModel

SAMPLES_DIR = Path(__file__).resolve().parent / "samples"
LASTMOD = "2026-10-19"
_EXAMPLE_SETS = 3


def _md(text: str) -> str:
    """Escape what Markdown tables and emphasis would otherwise interpret."""
    return text.replace("|", "\\|").replace("_", "\\_").replace("*", "\\*")


def viewer_link(sample_id: str, node_id: str | None = None, view: str | None = None, **query: str) -> str:
    """Same format as frontend/src/lib/deepLink.ts."""
    link = f"/?sample={sample_id}"
    if node_id or view:
        params = [f"view={view}"] if view else []
        params += [f"{key}={quote(value, safe='')}" for key, value in query.items()]
        link += f"#/id/{quote(node_id or '', safe='')}" + ("?" + "&".join(params) if params else "")
    return link


def _types(model: ServiceModel) -> dict[str, EntityType]:
    return {t.qualified_name: t for s in model.schemas for t in s.entity_types}


def _body(entry: dict, model: ServiceModel) -> str:
    sid = entry["id"]
    types = _types(model)
    sets = [es for s in model.schemas for c in s.containers for es in c.entity_sets]
    stats = model.stats
    lines = [
        entry["description"],
        "",
        f"- **OData version:** {model.odata_version}",
    ]
    if entry.get("service_url"):
        lines.append(f"- **Service root:** `{entry['service_url']}`")
        lines.append(f"- **`$metadata`:** `{entry['service_url'].rstrip('/')}/$metadata`")
    lines += [
        f"- **Entity sets:** {len(sets)}, **entity types:** {stats.entity_type_count}, "
        f"**complex types:** {stats.complex_type_count}, **enum types:** {stats.enum_type_count}",
        "",
        f"[Open the ER diagram]({viewer_link(sid, view='diagram')}) · [Browse the tree]({viewer_link(sid)})",
        "",
        "## Entity sets",
        "",
        "| Entity set | Entity type | Key | Properties | Navigations |",
        "|---|---|---|---|---|",
    ]
    for es in sets:
        etype = types.get(es.entity_type)
        key = ", ".join(etype.key) if etype else ""
        props = len(etype.properties) if etype else 0
        navs = ", ".join(n.name for n in etype.navigation_properties) if etype else ""
        name = f"[{_md(es.name)}]({viewer_link(sid, es.id, 'data')})" if entry.get("data") else _md(es.name)
        type_name = _md(es.entity_type.rpartition(".")[2])
        lines.append(f"| {name} | {type_name} | {_md(key)} | {props} | {_md(navs) or '—'} |")
    if entry.get("data") and sets:
        lines += ["", "## Example queries", ""]
        for es in sets[:_EXAMPLE_SETS]:
            etype = types.get(es.entity_type)
            link = viewer_link(sid, es.id, "data", top="5")
            lines.append(f"- [First five {_md(es.name)}]({link}) — `{es.name}?$top=5`")
            if etype and etype.key:
                key = etype.key[0]
                link = viewer_link(sid, es.id, "data", top="5", orderby=f"{key} desc")
                query = f"{es.name}?$orderby={key} desc&$top=5"
                lines.append(f"- [{_md(es.name)} by {_md(key)}, descending]({link}) — `{query}`")
        lines += ["", "More examples: [OData query options cheat sheet](/guides/odata-query-options)."]
    else:
        lines += ["", "This sample has no live data; the snapshot shows the model only."]
    return "\n".join(lines)


def sample_pages() -> list[Page]:
    catalog = json.loads((SAMPLES_DIR / "samples.json").read_text(encoding="utf-8"))
    pages = []
    for entry in catalog:
        model = parse_metadata((SAMPLES_DIR / entry["file"]).read_bytes()).model
        pages.append(
            Page(
                slug=f"samples/{entry['id']}",
                title=f"{entry['name']} — entity sets, types and sample queries",
                heading=f"{entry['name']} sample service",
                description=(
                    f"{entry['description']} Entity sets, keys and navigations of the public "
                    f"OData {model.odata_version} service, with queries you can run in the browser."
                )[:300],
                body=_body(entry, model),
                lastmod=LASTMOD,
                cta_label="Open in the viewer",
                cta_href=viewer_link(entry["id"]),
            )
        )
    return pages
