"""Text exports of a service model: Markdown documentation and a Mermaid ER diagram."""

from __future__ import annotations

from app.odata.model import EntityType, ServiceModel, StructuredType


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
            facets.append(f"Default `{p.default_value}`")
        rows.append(
            f"| `{p.name}` | `{p.type}` | {'yes' if p.nullable else 'no'} | {'🔑' if p.is_key else ''} | "
            f"{', '.join(facets)} | {p.label or ''} |"
        )
    return rows


def to_markdown(model: ServiceModel) -> str:
    out: list[str] = []
    title = model.service_root or model.filename or "OData service"
    out.append(f"# {title}")
    out.append("")
    out.append(
        f"OData {model.odata_version} · {model.stats.entity_type_count} entity types · "
        f"{model.stats.entity_set_count} entity sets · {model.stats.navigation_count} navigations"
    )
    if model.metadata_url:
        out.append("")
        out.append(f"Metadata: <{model.metadata_url}>")
    for schema in model.schemas:
        out.append("")
        out.append(f"## Schema `{schema.namespace}`" + (f" (alias `{schema.alias}`)" if schema.alias else ""))
        for container in schema.containers:
            if container.entity_sets or container.singletons:
                out.append("")
                out.append(f"### Entity container `{container.name}`")
                out.append("")
                out.append("| Entity set | Entity type | Label |")
                out.append("|---|---|---|")
                for s in container.entity_sets:
                    out.append(f"| `{s.name}` | `{s.entity_type}` | {s.label or ''} |")
                for s in container.singletons:
                    out.append(f"| `{s.name}` (singleton) | `{s.entity_type}` | {s.label or ''} |")
            if container.operations:
                out.append("")
                out.append("| Function import | HTTP | Returns | Parameters |")
                out.append("|---|---|---|---|")
                for op in container.operations:
                    params = ", ".join(f"{p.name}: {p.type}" for p in op.parameters)
                    out.append(
                        f"| `{op.name}` | {op.http_method or ''} | "
                        f"`{op.return_type.type if op.return_type else ''}` | {params} |"
                    )
        for et in schema.entity_types:
            out.append("")
            heading = f"### Entity type `{et.name}`"
            if et.base_type:
                heading += f" : `{et.base_type}`"
            out.append(heading)
            if et.label or et.description:
                out.append("")
                out.append(" — ".join(x for x in (et.label, et.description) if x))
            out.append("")
            out.append(
                f"Key: {', '.join(f'`{k}`' for k in et.key) or '—'}"
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
                        f"{c.property} → {c.referenced_property}" for c in n.referential_constraints
                    )
                    out.append(
                        f"| `{n.name}` | `{n.target_type}` | {n.multiplicity} | {n.partner or ''} | {rc} |"
                    )
        for ct in schema.complex_types:
            out.append("")
            out.append(f"### Complex type `{ct.name}`")
            out.append("")
            out.extend(_property_rows(ct))
        for en in schema.enum_types:
            out.append("")
            out.append(f"### Enum type `{en.name}` ({en.underlying_type}{', flags' if en.is_flags else ''})")
            out.append("")
            out.append("| Member | Value |")
            out.append("|---|---|")
            for m in en.members:
                out.append(f"| `{m.name}` | {m.value if m.value is not None else ''} |")
        for op in schema.operations:
            out.append("")
            bound = f" bound to `{op.bound_to}`" if op.is_bound else ""
            out.append(f"### {op.kind.capitalize()} `{op.name}`{bound}")
            out.append("")
            for p in op.parameters:
                out.append(f"- `{p.name}`: `{p.type}`" + ("" if p.nullable else " (required)"))
            if op.return_type:
                out.append(f"- returns `{op.return_type.type}`")
    out.append("")
    return "\n".join(out)


def _mermaid_id(qualified_name: str) -> str:
    return qualified_name.replace(".", "_").replace("/", "_")


def _mermaid_type(name: str) -> str:
    base = name.rsplit(".", 1)[-1] if "." in name else name
    return base.replace("(", "_").replace(")", "")


def to_mermaid(model: ServiceModel) -> str:
    """Mermaid ``erDiagram``; one entity per entity type, one relation per navigation."""
    lines = ["erDiagram"]
    types: list[EntityType] = [et for s in model.schemas for et in s.entity_types]
    by_name = {et.qualified_name: et for et in types}
    for et in types:
        lines.append(f"    {_mermaid_id(et.qualified_name)} {{")
        for p in et.properties[:40]:
            marker = " PK" if p.is_key else ""
            lines.append(f"        {_mermaid_type(p.type)} {p.name}{marker}")
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
                f"{_mermaid_id(target.qualified_name)} : {nav.name}"
            )
        if et.base_type and et.base_type in by_name:
            lines.append(
                f"    {_mermaid_id(et.base_type)} ||--|| {_mermaid_id(et.qualified_name)} : inherits"
            )
    return "\n".join(lines) + "\n"
