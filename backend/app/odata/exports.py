"""Text exports of a service model: Markdown documentation and a Mermaid ER diagram."""

from __future__ import annotations

import re

from app.odata.model import EntityType, ServiceModel, StructuredType

# Names, labels and descriptions come from an untrusted $metadata document and the
# files get rendered by other tools: keep them from breaking out of a table cell or
# code span, or from adding links and HTML.


def _text(value: object) -> str:
    """Free text for a table cell or paragraph."""
    text = " ".join(str(value).split())
    return re.sub(r"([\\`*_\[\]<>|])", r"\\\1", text)


def _autolink(url: str) -> str:
    """URL for ``<…>``: an autolink ends at the first space or angle bracket."""
    return re.sub(r"[<>\s]", lambda m: f"%{ord(m.group()):02X}", url)


def _code(value: object) -> str:
    """A code span; backticks cannot be escaped inside one, so they are replaced."""
    text = " ".join(str(value).split()).replace("`", "'").replace("|", "\\|")
    return f"`{text}`"


def _type_label(name: str) -> str:
    return name.rsplit(".", 1)[-1] if name.startswith(("Edm.",)) is False and "." in name else name


def _property_rows(st: StructuredType) -> list[str]:
    rows = ["| Property | Type | Nullable | Key | Facets | Label |", "|---|---|---|---|---|---|"]
    for p in st.properties:
        facets = []
        if p.max_length is not None:
            facets.append(f"MaxLength {p.max_length}")
        if p.max_length_is_max:
            facets.append("MaxLength max")
        if p.precision is not None:
            facets.append(f"Precision {p.precision}")
        if p.scale is not None:
            facets.append(f"Scale {p.scale}")
        if p.default_value is not None:
            facets.append(f"Default {_code(p.default_value)}")
        rows.append(
            f"| {_code(p.name)} | {_code(p.type)} | {'yes' if p.nullable else 'no'} | "
            f"{'🔑' if p.is_key else ''} | "
            f"{', '.join(facets)} | {_text(p.label or '')} |"
        )
    return rows


def to_markdown(model: ServiceModel) -> str:
    out: list[str] = []
    title = model.service_root or model.filename or "OData service"
    out.append(f"# {_text(title)}")
    out.append("")
    out.append(
        f"OData {model.odata_version} · {model.stats.entity_type_count} entity types · "
        f"{model.stats.entity_set_count} entity sets · {model.stats.navigation_count} navigations"
    )
    if model.metadata_url:
        out.append("")
        out.append(f"Metadata: <{_autolink(model.metadata_url)}>")
    for schema in model.schemas:
        out.append("")
        alias = f" (alias {_code(schema.alias)})" if schema.alias else ""
        out.append(f"## Schema {_code(schema.namespace)}{alias}")
        for container in schema.containers:
            if container.entity_sets or container.singletons:
                out.append("")
                out.append(f"### Entity container {_code(container.name)}")
                out.append("")
                out.append("| Entity set | Entity type | Label |")
                out.append("|---|---|---|")
                for s in container.entity_sets:
                    out.append(f"| {_code(s.name)} | {_code(s.entity_type)} | {_text(s.label or '')} |")
                for s in container.singletons:
                    out.append(
                        f"| {_code(s.name)} (singleton) | {_code(s.entity_type)} | {_text(s.label or '')} |"
                    )
            if container.operations:
                out.append("")
                out.append("| Function import | HTTP | Returns | Parameters |")
                out.append("|---|---|---|---|")
                for op in container.operations:
                    params = ", ".join(_text(f"{p.name}: {p.type}") for p in op.parameters)
                    out.append(
                        f"| {_code(op.name)} | {_text(op.http_method or '')} | "
                        f"{_code(op.return_type.type if op.return_type else '')} | {params} |"
                    )
        for et in schema.entity_types:
            out.append("")
            heading = f"### Entity type {_code(et.name)}"
            if et.base_type:
                heading += f" : {_code(et.base_type)}"
            out.append(heading)
            if et.label or et.description:
                out.append("")
                out.append(" — ".join(_text(x) for x in (et.label, et.description) if x))
            out.append("")
            out.append(
                f"Key: {', '.join(_code(k) for k in et.key) or '—'}"
                + (" (inherited)" if et.key_inherited else "")
            )
            out.append("")
            out.extend(_property_rows(et))
            if et.navigation_properties:
                out.append("")
                out.append("| Navigation | Target | Multiplicity | Partner | Constraints |")
                out.append("|---|---|---|---|---|")
                for n in et.navigation_properties:
                    rc = ", ".join(
                        _text(f"{c.property} → {c.referenced_property}") for c in n.referential_constraints
                    )
                    out.append(
                        f"| {_code(n.name)} | {_code(n.target_type)} | {n.multiplicity} | "
                        f"{_text(n.partner or '')} | {rc} |"
                    )
        for ct in schema.complex_types:
            out.append("")
            out.append(f"### Complex type {_code(ct.name)}")
            out.append("")
            out.extend(_property_rows(ct))
        for en in schema.enum_types:
            out.append("")
            flags = ", flags" if en.is_flags else ""
            out.append(f"### Enum type {_code(en.name)} ({_text(en.underlying_type)}{flags})")
            out.append("")
            out.append("| Member | Value |")
            out.append("|---|---|")
            for m in en.members:
                out.append(f"| {_code(m.name)} | {_text(m.value) if m.value is not None else ''} |")
        for op in schema.operations:
            out.append("")
            bound = f" bound to {_code(op.bound_to)}" if op.is_bound else ""
            out.append(f"### {op.kind.capitalize()} {_code(op.name)}{bound}")
            out.append("")
            for p in op.parameters:
                required = "" if p.nullable else " (required)"
                out.append(f"- {_code(p.name)}: {_code(p.type)}{required}")
            if op.return_type:
                out.append(f"- returns {_code(op.return_type.type)}")
    out.append("")
    return "\n".join(out)


def _mermaid_id(qualified_name: str) -> str:
    # Only word characters: anything else could end the entity block or start a new statement.
    return re.sub(r"\W", "_", qualified_name, flags=re.ASCII)


def _mermaid_type(name: str) -> str:
    base = name.rsplit(".", 1)[-1] if "." in name else name
    return _mermaid_id(base.replace(")", ""))


def to_mermaid(model: ServiceModel) -> str:
    """Mermaid ``erDiagram``; one entity per entity type, one relation per navigation."""
    lines = ["erDiagram"]
    types: list[EntityType] = [et for s in model.schemas for et in s.entity_types]
    by_name = {et.qualified_name: et for et in types}
    for et in types:
        lines.append(f"    {_mermaid_id(et.qualified_name)} {{")
        for p in et.properties[:40]:
            marker = " PK" if p.is_key else ""
            lines.append(f"        {_mermaid_type(p.type)} {_mermaid_id(p.name)}{marker}")
        if len(et.properties) > 40:
            lines.append(f"        more _{len(et.properties) - 40}_more")
        lines.append("    }")
    seen: set[tuple[str, str]] = set()
    for et in types:
        for nav in et.navigation_properties:
            target = by_name.get(nav.target_type)
            if target is None:
                continue
            key = (nav.id, f"nav:{target.qualified_name}/{nav.partner}" if nav.partner else "")
            if key[1] and (key[1], key[0]) in seen:
                continue
            seen.add(key)
            left = {"1": "||", "0..1": "|o", "*": "}o"}[nav.source_multiplicity or "0..1"]
            right = {"1": "||", "0..1": "o|", "*": "o{"}[nav.multiplicity]
            lines.append(
                f"    {_mermaid_id(et.qualified_name)} {left}--{right} "
                f"{_mermaid_id(target.qualified_name)} : {_mermaid_id(nav.name)}"
            )
        if et.base_type and et.base_type in by_name:
            lines.append(
                f"    {_mermaid_id(et.base_type)} ||--|| {_mermaid_id(et.qualified_name)} : inherits"
            )
    return "\n".join(lines) + "\n"
