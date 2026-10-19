"""Parse OData CSDL — EDMX 1.0 (V2/V3), EDMX 4.0 (V4/V4.01) and CSDL JSON — into
the version-neutral :mod:`app.odata.model`.

The XML side is namespace-agnostic on purpose: Microsoft shipped the EDM
schema under half a dozen namespaces (2006/04 … 2009/11) and OASIS under one
more. Elements are matched by local name; the EDMX ``Version`` attribute and
``m:DataServiceVersion`` decide which dialect applies.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from lxml import etree

from app.odata.model import (
    Annotation,
    ComplexType,
    EntityContainer,
    EntitySet,
    EntityType,
    EnumMember,
    EnumType,
    Multiplicity,
    NavigationBinding,
    NavigationProperty,
    Operation,
    OperationImport,
    Parameter,
    Property,
    Reference,
    ReferenceInclude,
    ReferentialConstraint,
    ReturnType,
    Schema,
    ServiceModel,
    ServiceStats,
    Singleton,
    TypeDefinition,
)
from app.parser.errors import humanize_syntax_error, looks_like_html
from app.parser.security import inspect_dtd, make_parser


class MetadataError(ValueError):
    """The input is not an OData metadata document we can read."""


# Well-known vocabulary terms used for labels/descriptions, by full name.
_LABEL_TERMS = {
    "com.sap.vocabularies.Common.v1.Label",
    "Org.OData.Display.V1.DisplayName",
}
_DESCRIPTION_TERMS = {
    "Org.OData.Core.V1.Description",
    "Org.OData.Core.V1.LongDescription",
    "com.sap.vocabularies.Common.v1.QuickInfo",
}
# Aliases the OData vocabularies document themselves under; used when a
# document uses the alias without an edmx:Reference (SAP often does).
_WELL_KNOWN_ALIASES = {
    "Core": "Org.OData.Core.V1",
    "Capabilities": "Org.OData.Capabilities.V1",
    "Measures": "Org.OData.Measures.V1",
    "Validation": "Org.OData.Validation.V1",
    "Aggregation": "Org.OData.Aggregation.V1",
    "Authorization": "Org.OData.Authorization.V1",
    "Common": "com.sap.vocabularies.Common.v1",
    "UI": "com.sap.vocabularies.UI.v1",
    "Communication": "com.sap.vocabularies.Communication.v1",
    "Analytics": "com.sap.vocabularies.Analytics.v1",
    "PersonalData": "com.sap.vocabularies.PersonalData.v1",
}

_SAP_NS = "http://www.sap.com/Protocols/SAPData"
_M_NS = "http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"
_COLLECTION_RE = re.compile(r"^Collection\((.+)\)$")
_ANNOTATION_VALUE_ATTRS = (
    "String",
    "Bool",
    "Int",
    "Decimal",
    "Float",
    "Date",
    "DateTimeOffset",
    "Duration",
    "TimeOfDay",
    "Guid",
    "EnumMember",
    "Path",
    "PropertyPath",
    "NavigationPropertyPath",
    "AnnotationPath",
    "UrlRef",
    "Binary",
)


def _local(el: etree._Element) -> str:
    return etree.QName(el).localname


def _children(el: etree._Element, *names: str) -> list[etree._Element]:
    wanted = set(names)
    return [c for c in el if isinstance(c.tag, str) and _local(c) in wanted]


def _child(el: etree._Element, name: str) -> etree._Element | None:
    found = _children(el, name)
    return found[0] if found else None


def _bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() == "true"


def _int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _scale(value: str | None) -> int | str | None:
    if value is None:
        return None
    if value.lower() in ("variable", "floating"):
        return value.lower()
    return _int(value)


def split_collection(type_name: str) -> tuple[str, bool]:
    """``Collection(NS.T)`` → (``NS.T``, True); anything else → (name, False)."""
    match = _COLLECTION_RE.match(type_name.strip())
    if match:
        return match.group(1).strip(), True
    return type_name.strip(), False


@dataclass
class _Context:
    """Everything the two passes share: alias map, version, indexes, notices."""

    version: str
    aliases: dict[str, str] = field(default_factory=dict)
    notices: list[str] = field(default_factory=list)
    unresolved: Counter = field(default_factory=Counter)
    # V2: qualified association name → Association element
    associations: dict[str, etree._Element] = field(default_factory=dict)
    # Index of qualified name → structured/enum/typedef/operation/container
    index: dict[str, Any] = field(default_factory=dict)
    entity_types: dict[str, EntityType] = field(default_factory=dict)

    def qualify(self, name: str | None) -> str | None:
        """Replace a schema alias by its namespace (``Self.Person`` → ``NS.Person``)."""
        if not name:
            return name
        inner, is_collection = split_collection(name)
        prefix, dot, local = inner.rpartition(".")
        if dot and prefix in self.aliases:
            inner = f"{self.aliases[prefix]}.{local}"
        return f"Collection({inner})" if is_collection else inner

    def term(self, name: str) -> str:
        """Resolve a vocabulary alias in an annotation term name."""
        prefix, dot, local = name.rpartition(".")
        if not dot:
            return name
        if prefix in self.aliases:
            return f"{self.aliases[prefix]}.{local}"
        if prefix in _WELL_KNOWN_ALIASES:
            return f"{_WELL_KNOWN_ALIASES[prefix]}.{local}"
        return name


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------


def _annotation_value(el: etree._Element) -> str | None:
    for attr in _ANNOTATION_VALUE_ATTRS:
        value = el.get(attr)
        if value is not None:
            return value
    for child in el:
        if not isinstance(child.tag, str):
            continue
        name = _local(child)
        if name == "Collection":
            items = [c for c in child if isinstance(c.tag, str)]
            return f"[{len(items)} item{'s' if len(items) != 1 else ''}]"
        if name == "Record":
            names = [pv.get("Property") for pv in _children(child, "PropertyValue") if pv.get("Property")]
            return "{" + ", ".join(names) + "}" if names else "{record}"
        if name in _ANNOTATION_VALUE_ATTRS:
            return (child.text or "").strip()
        if name in ("Null",):
            return "null"
        if name in ("Apply", "If", "Cast", "IsOf", "LabeledElement", "UrlRef"):
            return f"<{name}>"
    text = (el.text or "").strip()
    return text or None


# Bounds for Annotation.structured: SAP services carry UI annotations with
# hundreds of records; the detail panel needs the shape, not every corner.
STRUCTURED_MAX_DEPTH = 5
STRUCTURED_MAX_NODES = 300
_TRUNCATED = "…"


class _Budget:
    def __init__(self) -> None:
        self.left = STRUCTURED_MAX_NODES

    def take(self) -> bool:
        self.left -= 1
        return self.left >= 0


def _xml_item(el: etree._Element, ctx: _Context, budget: _Budget, depth: int) -> Any:
    if not budget.take() or depth > STRUCTURED_MAX_DEPTH:
        return _TRUNCATED
    name = _local(el)
    if name == "Collection":
        return [_xml_item(c, ctx, budget, depth + 1) for c in el if isinstance(c.tag, str)]
    if name == "Record":
        record: dict[str, Any] = {}
        if el.get("Type"):
            record["$Type"] = ctx.term(el.get("Type"))
        for pv in _children(el, "PropertyValue"):
            if pv.get("Property"):
                record[pv.get("Property")] = _xml_structure(pv, ctx, budget, depth + 1)
        return record
    if name in _ANNOTATION_VALUE_ATTRS:
        return (el.text or "").strip()
    if name == "Null":
        return None
    return f"<{name}>"


def _xml_structure(el: etree._Element, ctx: _Context, budget: _Budget, depth: int = 0) -> Any:
    """Value of an ``Annotation`` or ``PropertyValue`` element as JSON."""
    for attr in _ANNOTATION_VALUE_ATTRS:
        value = el.get(attr)
        if value is not None:
            return value
    for child in el:
        if isinstance(child.tag, str) and _local(child) != "Annotation":
            return _xml_item(child, ctx, budget, depth)
    return (el.text or "").strip() or None


def _xml_annotation(ann: etree._Element, ctx: _Context, qualifier: str | None = None) -> Annotation:
    has_structure = any(isinstance(c.tag, str) and _local(c) in ("Collection", "Record") for c in ann)
    return Annotation(
        term=ctx.term(ann.get("Term")),
        qualifier=ann.get("Qualifier") or qualifier,
        value=_annotation_value(ann),
        structured=_xml_structure(ann, ctx, _Budget()) if has_structure else None,
    )


def _inline_annotations(el: etree._Element, ctx: _Context) -> list[Annotation]:
    """V4 ``<Annotation>`` children plus any foreign-namespace attributes
    (``sap:label``, ``m:HasStream`` is handled separately)."""
    result: list[Annotation] = []
    for ann in _children(el, "Annotation"):
        term = ann.get("Term")
        if not term:
            continue
        result.append(_xml_annotation(ann, ctx))
    nsmap = {uri: prefix for prefix, uri in (el.nsmap or {}).items() if prefix}
    for key, value in el.attrib.items():
        if not key.startswith("{"):
            continue
        uri, _, local = key[1:].partition("}")
        prefix = nsmap.get(uri) or ("sap" if uri == _SAP_NS else "m" if uri == _M_NS else None)
        if prefix is None:
            prefix = uri.rsplit("/", 1)[-1] or uri
        result.append(Annotation(term=f"{prefix}:{local}", value=value))
    return result


def _pick_text(annotations: list[Annotation], terms: set[str], legacy: tuple[str, ...]) -> str | None:
    for ann in annotations:
        if ann.term in terms and ann.value:
            return ann.value
    for ann in annotations:
        if ann.term in legacy and ann.value:
            return ann.value
    return None


def _label(annotations: list[Annotation]) -> str | None:
    return _pick_text(annotations, _LABEL_TERMS, ("sap:label",))


def _description(annotations: list[Annotation]) -> str | None:
    return _pick_text(annotations, _DESCRIPTION_TERMS, ("sap:quickinfo", "sap:heading"))


# ---------------------------------------------------------------------------
# Structural members
# ---------------------------------------------------------------------------


def _property(el: etree._Element, owner_qn: str, key: set[str], ctx: _Context) -> Property:
    name = el.get("Name") or "?"
    raw_type = ctx.qualify(el.get("Type") or "Edm.String") or "Edm.String"
    inner, is_collection = split_collection(raw_type)
    annotations = _inline_annotations(el, ctx)
    max_length = el.get("MaxLength")
    return Property(
        id=f"prop:{owner_qn}/{name}",
        name=name,
        type=raw_type,
        is_collection=is_collection,
        nullable=_bool(el.get("Nullable"), True),
        is_key=name in key,
        max_length=None if (max_length or "").lower() == "max" else _int(max_length),
        max_length_is_max=(max_length or "").lower() == "max",
        precision=_int(el.get("Precision")),
        scale=_scale(el.get("Scale")),
        default_value=el.get("DefaultValue"),
        unicode=None if el.get("Unicode") is None else _bool(el.get("Unicode"), True),
        srid=el.get("SRID"),
        label=_label(annotations),
        description=_description(annotations),
        annotations=annotations,
        line=el.sourceline,
    )


def _multiplicity_from_v4(is_collection: bool, nullable: bool) -> Multiplicity:
    if is_collection:
        return "*"
    return "0..1" if nullable else "1"


def _navigation_v4(el: etree._Element, owner_qn: str, ctx: _Context) -> NavigationProperty:
    name = el.get("Name") or "?"
    raw_type = ctx.qualify(el.get("Type") or "") or ""
    target, is_collection = split_collection(raw_type)
    nullable = _bool(el.get("Nullable"), True)
    annotations = _inline_annotations(el, ctx)
    constraints = [
        ReferentialConstraint(
            property=rc.get("Property") or "", referenced_property=rc.get("ReferencedProperty") or ""
        )
        for rc in _children(el, "ReferentialConstraint")
    ]
    on_delete = _child(el, "OnDelete")
    return NavigationProperty(
        id=f"nav:{owner_qn}/{name}",
        name=name,
        target_type=target,
        is_collection=is_collection,
        nullable=nullable if not is_collection else True,
        multiplicity=_multiplicity_from_v4(is_collection, nullable),
        partner=el.get("Partner"),
        contains_target=_bool(el.get("ContainsTarget"), False),
        referential_constraints=constraints,
        on_delete=on_delete.get("Action") if on_delete is not None else None,
        label=_label(annotations),
        description=_description(annotations),
        annotations=annotations,
        line=el.sourceline,
    )


def _navigation_v2(el: etree._Element, owner_qn: str, ctx: _Context) -> NavigationProperty | None:
    """V2/V3 navigation property: resolve the association's ends and constraint."""
    name = el.get("Name") or "?"
    relationship = ctx.qualify(el.get("Relationship")) or ""
    from_role, to_role = el.get("FromRole"), el.get("ToRole")
    annotations = _inline_annotations(el, ctx)
    association = ctx.associations.get(relationship)
    target = ""
    multiplicity: Multiplicity = "0..1"
    source_multiplicity: Multiplicity | None = None
    constraints: list[ReferentialConstraint] = []
    on_delete = None
    if association is None:
        ctx.unresolved[f"association {relationship}"] += 1
    else:
        ends = {end.get("Role"): end for end in _children(association, "End")}
        to_end, from_end = ends.get(to_role), ends.get(from_role)
        if to_end is not None:
            target = ctx.qualify(to_end.get("Type")) or ""
            multiplicity = _as_multiplicity(to_end.get("Multiplicity"))
            od = _child(to_end, "OnDelete")
            on_delete = od.get("Action") if od is not None else None
        if from_end is not None:
            source_multiplicity = _as_multiplicity(from_end.get("Multiplicity"))
        rc = _child(association, "ReferentialConstraint")
        if rc is not None:
            principal, dependent = _child(rc, "Principal"), _child(rc, "Dependent")
            if principal is not None and dependent is not None and dependent.get("Role") == from_role:
                principal_refs = [p.get("Name") or "" for p in _children(principal, "PropertyRef")]
                dependent_refs = [p.get("Name") or "" for p in _children(dependent, "PropertyRef")]
                constraints = [
                    ReferentialConstraint(property=d, referenced_property=p)
                    for d, p in zip(dependent_refs, principal_refs, strict=False)
                ]
    is_collection = multiplicity == "*"
    return NavigationProperty(
        id=f"nav:{owner_qn}/{name}",
        name=name,
        target_type=target,
        is_collection=is_collection,
        nullable=multiplicity != "1",
        multiplicity=multiplicity,
        source_multiplicity=source_multiplicity,
        relationship=relationship or None,
        referential_constraints=constraints,
        on_delete=on_delete,
        label=_label(annotations),
        description=_description(annotations),
        annotations=annotations,
        line=el.sourceline,
    )


def _as_multiplicity(value: str | None) -> Multiplicity:
    value = (value or "").strip()
    if value == "*":
        return "*"
    if value == "1":
        return "1"
    return "0..1"


def _structured(
    el: etree._Element, namespace: str, ctx: _Context, *, entity: bool
) -> EntityType | ComplexType:
    name = el.get("Name") or "?"
    qn = f"{namespace}.{name}"
    key_el = _child(el, "Key")
    key = [ref.get("Name") or "" for ref in _children(key_el, "PropertyRef")] if key_el is not None else []
    key_set = set(key)
    properties = [_property(p, qn, key_set, ctx) for p in _children(el, "Property")]
    navs: list[NavigationProperty] = []
    for nav in _children(el, "NavigationProperty"):
        parsed = _navigation_v4(nav, qn, ctx) if ctx.version.startswith("4") else _navigation_v2(nav, qn, ctx)
        if parsed is not None:
            navs.append(parsed)
    annotations = _inline_annotations(el, ctx)
    common: dict[str, Any] = {
        "name": name,
        "namespace": namespace,
        "qualified_name": qn,
        "base_type": ctx.qualify(el.get("BaseType")),
        "abstract": _bool(el.get("Abstract"), False),
        "open_type": _bool(el.get("OpenType"), False),
        "properties": properties,
        "navigation_properties": navs,
        "label": _label(annotations),
        "description": _description(annotations),
        "annotations": annotations,
        "line": el.sourceline,
    }
    if entity:
        has_stream = _bool(el.get("HasStream"), False) or _bool(el.get(f"{{{_M_NS}}}HasStream"), False)
        return EntityType(id=f"type:{qn}", key=key, has_stream=has_stream, **common)
    return ComplexType(id=f"complex:{qn}", **common)


def _enum(el: etree._Element, namespace: str, ctx: _Context) -> EnumType:
    name = el.get("Name") or "?"
    qn = f"{namespace}.{name}"
    members = []
    for i, m in enumerate(_children(el, "Member")):
        m_ann = _inline_annotations(m, ctx)
        value = _int(m.get("Value"))
        members.append(
            EnumMember(
                name=m.get("Name") or "?", value=value if value is not None else i, label=_label(m_ann)
            )
        )
    annotations = _inline_annotations(el, ctx)
    return EnumType(
        id=f"enum:{qn}",
        name=name,
        namespace=namespace,
        qualified_name=qn,
        underlying_type=ctx.qualify(el.get("UnderlyingType")) or "Edm.Int32",
        is_flags=_bool(el.get("IsFlags"), False),
        members=members,
        label=_label(annotations),
        description=_description(annotations),
        annotations=annotations,
        line=el.sourceline,
    )


def _typedef(el: etree._Element, namespace: str, ctx: _Context) -> TypeDefinition:
    name = el.get("Name") or "?"
    qn = f"{namespace}.{name}"
    annotations = _inline_annotations(el, ctx)
    return TypeDefinition(
        id=f"typedef:{qn}",
        name=name,
        namespace=namespace,
        qualified_name=qn,
        underlying_type=ctx.qualify(el.get("UnderlyingType")) or "Edm.String",
        max_length=_int(el.get("MaxLength")),
        precision=_int(el.get("Precision")),
        scale=_scale(el.get("Scale")),
        label=_label(annotations),
        description=_description(annotations),
        annotations=annotations,
        line=el.sourceline,
    )


def _parameter(el: etree._Element, ctx: _Context) -> Parameter:
    raw_type = ctx.qualify(el.get("Type") or "Edm.String") or "Edm.String"
    inner, is_collection = split_collection(raw_type)
    return Parameter(
        name=el.get("Name") or "?",
        type=raw_type,
        is_collection=is_collection,
        nullable=_bool(el.get("Nullable"), True),
        mode=el.get("Mode"),
        max_length=_int(el.get("MaxLength")),
        precision=_int(el.get("Precision")),
        scale=_scale(el.get("Scale")),
        annotations=_inline_annotations(el, ctx),
    )


def _return_type(type_name: str | None, nullable: str | None, ctx: _Context) -> ReturnType | None:
    if not type_name:
        return None
    raw = ctx.qualify(type_name) or type_name
    inner, is_collection = split_collection(raw)
    return ReturnType(type=raw, is_collection=is_collection, nullable=_bool(nullable, True))


def _operation_v4(el: etree._Element, namespace: str, index: int, ctx: _Context) -> Operation:
    name = el.get("Name") or "?"
    qn = f"{namespace}.{name}"
    kind = "function" if _local(el) == "Function" else "action"
    params = [_parameter(p, ctx) for p in _children(el, "Parameter")]
    is_bound = _bool(el.get("IsBound"), False)
    rt = _child(el, "ReturnType")
    annotations = _inline_annotations(el, ctx)
    return Operation(
        id=f"op:{qn}#{index}",
        kind=kind,
        name=name,
        namespace=namespace,
        qualified_name=qn,
        is_bound=is_bound,
        bound_to=params[0].type if is_bound and params else None,
        is_composable=_bool(el.get("IsComposable"), False),
        entity_set_path=el.get("EntitySetPath"),
        parameters=params,
        return_type=_return_type(rt.get("Type"), rt.get("Nullable"), ctx) if rt is not None else None,
        label=_label(annotations),
        description=_description(annotations),
        annotations=annotations,
        line=el.sourceline,
    )


def _function_import_v2(
    el: etree._Element, container_qn: str, namespace: str, index: int, ctx: _Context
) -> Operation:
    name = el.get("Name") or "?"
    annotations = _inline_annotations(el, ctx)
    http_method = el.get(f"{{{_M_NS}}}HttpMethod") or el.get("HttpMethod")
    return Operation(
        id=f"op:{container_qn}/{name}#{index}",
        kind="function_import",
        name=name,
        namespace=namespace,
        qualified_name=f"{container_qn}/{name}",
        entity_set=el.get("EntitySet"),
        http_method=http_method,
        parameters=[_parameter(p, ctx) for p in _children(el, "Parameter")],
        return_type=_return_type(el.get("ReturnType"), None, ctx),
        label=_label(annotations),
        description=_description(annotations),
        annotations=annotations,
        line=el.sourceline,
    )


def _container(el: etree._Element, namespace: str, ctx: _Context) -> EntityContainer:
    name = el.get("Name") or "?"
    qn = f"{namespace}.{name}"
    sets: list[EntitySet] = []
    for s in _children(el, "EntitySet"):
        s_ann = _inline_annotations(s, ctx)
        sets.append(
            EntitySet(
                id=f"set:{qn}/{s.get('Name')}",
                name=s.get("Name") or "?",
                entity_type=ctx.qualify(s.get("EntityType")) or "",
                navigation_bindings=[
                    NavigationBinding(path=b.get("Path") or "", target=b.get("Target") or "")
                    for b in _children(s, "NavigationPropertyBinding")
                ],
                include_in_service_document=_bool(s.get("IncludeInServiceDocument"), True),
                label=_label(s_ann),
                description=_description(s_ann),
                annotations=s_ann,
                line=s.sourceline,
            )
        )
    singletons = [
        Singleton(
            id=f"singleton:{qn}/{s.get('Name')}",
            name=s.get("Name") or "?",
            entity_type=ctx.qualify(s.get("Type")) or "",
            navigation_bindings=[
                NavigationBinding(path=b.get("Path") or "", target=b.get("Target") or "")
                for b in _children(s, "NavigationPropertyBinding")
            ],
            annotations=_inline_annotations(s, ctx),
            line=s.sourceline,
        )
        for s in _children(el, "Singleton")
    ]
    imports: list[OperationImport] = []
    operations: list[Operation] = []
    if ctx.version.startswith("4"):
        for imp in _children(el, "FunctionImport", "ActionImport"):
            is_function = _local(imp) == "FunctionImport"
            imports.append(
                OperationImport(
                    id=f"import:{qn}/{imp.get('Name')}",
                    kind="function_import" if is_function else "action_import",
                    name=imp.get("Name") or "?",
                    operation=ctx.qualify(imp.get("Function") if is_function else imp.get("Action")) or "",
                    entity_set=imp.get("EntitySet"),
                    include_in_service_document=_bool(imp.get("IncludeInServiceDocument"), not is_function),
                    annotations=_inline_annotations(imp, ctx),
                    line=imp.sourceline,
                )
            )
    else:
        for i, imp in enumerate(_children(el, "FunctionImport")):
            operations.append(_function_import_v2(imp, qn, namespace, i, ctx))
        # AssociationSets tell which entity set a navigation leads to.
        _bind_v2_association_sets(el, sets, ctx)
    is_default = _bool(el.get(f"{{{_M_NS}}}IsDefaultEntityContainer"), ctx.version.startswith("4"))
    return EntityContainer(
        id=f"container:{qn}",
        name=name,
        namespace=namespace,
        qualified_name=qn,
        extends=ctx.qualify(el.get("Extends")),
        is_default=is_default,
        entity_sets=sets,
        singletons=singletons,
        operation_imports=imports,
        operations=operations,
        annotations=_inline_annotations(el, ctx),
        line=el.sourceline,
    )


def _bind_v2_association_sets(container: etree._Element, sets: list[EntitySet], ctx: _Context) -> None:
    """Derive V4-style navigation bindings from V2 ``AssociationSet`` ends.

    Done in a second step (after all types are known) because the binding path
    is the navigation property name, which lives on the entity type.
    """
    by_name = {s.name: s for s in sets}
    pending: list[tuple[str, str, str, str]] = []  # (association, role, entity set, other role → set)
    for aset in _children(container, "AssociationSet"):
        association = ctx.qualify(aset.get("Association")) or ""
        ends = _children(aset, "End")
        if len(ends) != 2:
            continue
        for end, other in ((ends[0], ends[1]), (ends[1], ends[0])):
            role, entity_set, other_set = (
                end.get("Role") or "",
                end.get("EntitySet") or "",
                other.get("EntitySet") or "",
            )
            if entity_set in by_name:
                pending.append((association, role, entity_set, other_set))
    ctx.index.setdefault("__v2_bindings__", []).extend(pending)


def _finish_v2_bindings(model_schemas: list[Schema], ctx: _Context) -> None:
    pending = ctx.index.pop("__v2_bindings__", [])
    if not pending:
        return
    sets_by_name: dict[str, EntitySet] = {}
    for schema in model_schemas:
        for container in schema.containers:
            for s in container.entity_sets:
                sets_by_name[s.name] = s
    for association, role, set_name, target_set in pending:
        entity_set = sets_by_name.get(set_name)
        entity_type = ctx.entity_types.get(entity_set.entity_type) if entity_set else None
        if entity_set is None or entity_type is None:
            continue
        for nav in _iter_navigations(entity_type, ctx):
            # The From end of the navigation is this set's role in the association.
            if (
                nav.relationship == association
                and _from_role(nav, ctx) == role
                and not any(b.path == nav.name for b in entity_set.navigation_bindings)
            ):
                entity_set.navigation_bindings.append(NavigationBinding(path=nav.name, target=target_set))


def _iter_navigations(entity_type: EntityType, ctx: _Context):
    seen: set[str] = set()
    current: EntityType | None = entity_type
    while current is not None and current.qualified_name not in seen:
        seen.add(current.qualified_name)
        yield from current.navigation_properties
        current = ctx.entity_types.get(current.base_type) if current.base_type else None


def _from_role(nav: NavigationProperty, ctx: _Context) -> str | None:
    """Recover the V2 FromRole: the end whose multiplicity/type is this side."""
    association = ctx.associations.get(nav.relationship or "")
    if association is None:
        return None
    ends = _children(association, "End")
    for end in ends:
        if (ctx.qualify(end.get("Type")) or "") != nav.target_type or _as_multiplicity(
            end.get("Multiplicity")
        ) != nav.multiplicity:
            return end.get("Role")
    # Self-referencing association with equal ends: fall back to the first end.
    return ends[0].get("Role") if ends else None


# ---------------------------------------------------------------------------
# External annotations (<Annotations Target="…">)
# ---------------------------------------------------------------------------


def _apply_external_annotations(schema_el: etree._Element, ctx: _Context) -> int:
    applied = 0
    for block in _children(schema_el, "Annotations"):
        target = ctx.qualify(block.get("Target") or "") or ""
        qualifier = block.get("Qualifier")
        node = _resolve_target(target, ctx)
        if node is None:
            ctx.unresolved[f"annotation target {target}"] += 1
            continue
        for ann in _children(block, "Annotation"):
            term = ann.get("Term")
            if not term:
                continue
            node.annotations.append(_xml_annotation(ann, ctx, qualifier))
            applied += 1
        if hasattr(node, "label") and node.label is None:
            node.label = _label(node.annotations)
        if hasattr(node, "description") and node.description is None:
            node.description = _description(node.annotations)
    return applied


def _resolve_target(target: str, ctx: _Context) -> Any | None:
    # Strip operation overload signature: NS.Func(NS.Type) → NS.Func
    base, _, member = re.sub(r"\(.*\)$", "", target).partition("/")
    node = ctx.index.get(base)
    if node is None:
        return None
    if not member:
        return node
    for attr in (
        "properties",
        "navigation_properties",
        "entity_sets",
        "singletons",
        "operation_imports",
        "members",
    ):
        items = getattr(node, attr, None)
        if items:
            for item in items:
                if getattr(item, "name", None) == member:
                    return item
    return None


# ---------------------------------------------------------------------------
# Document level (XML)
# ---------------------------------------------------------------------------


def _detect_version(
    root: etree._Element, data_services: etree._Element | None
) -> tuple[str, str | None, str | None]:
    edmx_version = root.get("Version")
    dsv = None
    if data_services is not None:
        dsv = data_services.get(f"{{{_M_NS}}}MaxDataServiceVersion") or data_services.get(
            f"{{{_M_NS}}}DataServiceVersion"
        )
    if edmx_version and edmx_version.startswith("4"):
        version = "4.01" if edmx_version.startswith("4.01") else "4.0"
    elif dsv and dsv.strip().startswith("3"):
        version = "3.0"
    else:
        version = "2.0"
    return version, edmx_version, dsv


def _parse_xml_root(data: bytes) -> etree._Element:
    if looks_like_html(data):
        raise MetadataError(
            "The response is an HTML page, not an OData $metadata document. The service probably "
            "requires a login (enter the credentials below) or the URL points at a website."
        )
    try:
        internal = inspect_dtd(data)
        root = etree.fromstring(data, parser=make_parser(internal_entities=internal))
    except etree.XMLSyntaxError as exc:
        raise MetadataError(humanize_syntax_error(exc, data)) from exc
    return root


def parse_metadata_xml(data: bytes) -> tuple[ServiceModel, etree._Element]:
    """Parse an EDMX document. Returns the model and the root element."""
    root = _parse_xml_root(data)
    root_name = _local(root)
    if root_name == "service":
        raise MetadataError(
            "This is the OData service document (list of entity sets), not the metadata. "
            "Append /$metadata to the URL."
        )
    if root_name == "feed" or root_name == "entry":
        raise MetadataError(
            "This is an OData Atom feed, not the metadata document. Use the service's $metadata URL."
        )
    if root_name != "Edmx":
        raise MetadataError(
            f"Not an OData metadata document: the root element is <{root_name}>, expected <edmx:Edmx>."
        )
    data_services = _child(root, "DataServices")
    if data_services is None:
        raise MetadataError("The EDMX document has no <edmx:DataServices> element.")
    version, edmx_version, dsv = _detect_version(root, data_services)
    ctx = _Context(version=version)

    references: list[Reference] = []
    for ref in _children(root, "Reference"):
        includes = []
        for inc in _children(ref, "Include"):
            ns, alias = inc.get("Namespace") or "", inc.get("Alias")
            includes.append(ReferenceInclude(namespace=ns, alias=alias))
            if alias and ns:
                ctx.aliases[alias] = ns
        references.append(Reference(uri=ref.get("Uri") or "", includes=includes))

    schema_els = _children(data_services, "Schema")
    if not schema_els:
        raise MetadataError("The metadata document contains no <Schema> element.")
    for schema_el in schema_els:
        ns, alias = schema_el.get("Namespace") or "", schema_el.get("Alias")
        if alias and ns:
            ctx.aliases[alias] = ns
        for assoc in _children(schema_el, "Association"):
            ctx.associations[f"{ns}.{assoc.get('Name')}"] = assoc

    schemas: list[Schema] = []
    for schema_el in schema_els:
        ns = schema_el.get("Namespace") or ""
        schema = Schema(
            id=f"schema:{ns}", namespace=ns, alias=schema_el.get("Alias"), line=schema_el.sourceline
        )
        for el in schema_el:
            if not isinstance(el.tag, str):
                continue
            kind = _local(el)
            if kind == "EntityType":
                et = _structured(el, ns, ctx, entity=True)
                schema.entity_types.append(et)
                ctx.index[et.qualified_name] = et
                ctx.entity_types[et.qualified_name] = et
            elif kind == "ComplexType":
                ct = _structured(el, ns, ctx, entity=False)
                schema.complex_types.append(ct)
                ctx.index[ct.qualified_name] = ct
            elif kind == "EnumType":
                en = _enum(el, ns, ctx)
                schema.enum_types.append(en)
                ctx.index[en.qualified_name] = en
            elif kind == "TypeDefinition":
                td = _typedef(el, ns, ctx)
                schema.type_definitions.append(td)
                ctx.index[td.qualified_name] = td
            elif kind in ("Function", "Action") and version.startswith("4"):
                op = _operation_v4(el, ns, len(schema.operations), ctx)
                schema.operations.append(op)
                ctx.index.setdefault(op.qualified_name, op)
            elif kind == "EntityContainer":
                container = _container(el, ns, ctx)
                schema.containers.append(container)
                ctx.index[container.qualified_name] = container
                for s in container.entity_sets:
                    ctx.index[f"{container.qualified_name}/{s.name}"] = s
                for op in container.operations:
                    ctx.index[op.qualified_name] = op
        schema.annotations = _inline_annotations(schema_el, ctx)
        schemas.append(schema)

    annotation_count = 0
    for schema_el in schema_els:
        annotation_count += _apply_external_annotations(schema_el, ctx)

    _finish_v2_bindings(schemas, ctx)
    model = ServiceModel(
        filename="",
        source="",
        format="xml",
        odata_version=version,  # type: ignore[arg-type]
        edmx_version=edmx_version,
        data_service_version=dsv,
        schemas=schemas,
        references=references,
    )
    _finish(model, ctx, extra_annotations=annotation_count)
    return model, root


# ---------------------------------------------------------------------------
# CSDL JSON (V4.01)
# ---------------------------------------------------------------------------


def _json_annotations(obj: dict[str, Any], ctx: _Context, prefix: str = "") -> list[Annotation]:
    result = []
    for key, value in obj.items():
        if not key.startswith(prefix + "@"):
            continue
        term, _, qualifier = key[len(prefix) + 1 :].partition("#")
        structured = _json_structure(value, ctx, _Budget()) if isinstance(value, (dict, list)) else None
        result.append(
            Annotation(
                term=ctx.term(term),
                qualifier=qualifier or None,
                value=_json_value(value),
                structured=structured,
            )
        )
    return result


_JSON_PATH_KEYS = ("$Path", "$PropertyPath", "$NavigationPropertyPath", "$AnnotationPath", "$EnumMember")


def _json_structure(value: Any, ctx: _Context, budget: _Budget, depth: int = 0) -> Any:
    """CSDL JSON annotation value in the same shape :func:`_xml_structure` produces."""
    if not budget.take() or depth > STRUCTURED_MAX_DEPTH:
        return _TRUNCATED
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return [_json_structure(v, ctx, budget, depth + 1) for v in value]
    if isinstance(value, dict):
        for key in _JSON_PATH_KEYS:
            if key in value:
                return str(value[key])
        record: dict[str, Any] = {}
        if isinstance(value.get("@type"), str):
            record["$Type"] = ctx.term(value["@type"].lstrip("#"))
        for key, item in value.items():
            if not key.startswith("@") and not key.startswith("$"):
                record[key] = _json_structure(item, ctx, budget, depth + 1)
        return record
    return str(value)


def _json_value(value: Any) -> str | None:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float, str)):
        return str(value)
    if isinstance(value, list):
        return f"[{len(value)} item{'s' if len(value) != 1 else ''}]"
    if isinstance(value, dict):
        if "$Path" in value:
            return str(value["$Path"])
        names = [k for k in value if not k.startswith("$") and not k.startswith("@")]
        return "{" + ", ".join(names) + "}" if names else "{record}"
    return str(value)


def _json_type(spec: dict[str, Any], ctx: _Context, default: str = "Edm.String") -> tuple[str, bool]:
    base = ctx.qualify(spec.get("$Type", default)) or default
    is_collection = bool(spec.get("$Collection", False))
    return (f"Collection({base})" if is_collection else base), is_collection


def _json_structured(
    name: str, ns: str, spec: dict[str, Any], ctx: _Context, *, entity: bool
) -> EntityType | ComplexType:
    qn = f"{ns}.{name}"
    key: list[str] = []
    for k in spec.get("$Key", []) or []:
        key.append(next(iter(k.values())) if isinstance(k, dict) else str(k))
    key_set = set(key)
    properties: list[Property] = []
    navs: list[NavigationProperty] = []
    for member, mspec in spec.items():
        if member.startswith("$") or member.startswith("@") or not isinstance(mspec, dict):
            continue
        annotations = _json_annotations(mspec, ctx)
        if mspec.get("$Kind") == "NavigationProperty":
            raw, is_collection = _json_type(mspec, ctx, default="")
            target, _ = split_collection(raw)
            nullable = bool(mspec.get("$Nullable", True))
            navs.append(
                NavigationProperty(
                    id=f"nav:{qn}/{member}",
                    name=member,
                    target_type=target,
                    is_collection=is_collection,
                    nullable=nullable if not is_collection else True,
                    multiplicity=_multiplicity_from_v4(is_collection, nullable),
                    partner=mspec.get("$Partner"),
                    contains_target=bool(mspec.get("$ContainsTarget", False)),
                    referential_constraints=[
                        ReferentialConstraint(property=p, referenced_property=r)
                        for p, r in (mspec.get("$ReferentialConstraint") or {}).items()
                        if not p.endswith("@")
                    ],
                    on_delete=(mspec.get("$OnDelete") or None),
                    label=_label(annotations),
                    description=_description(annotations),
                    annotations=annotations,
                )
            )
            continue
        raw, is_collection = _json_type(mspec, ctx)
        max_length = mspec.get("$MaxLength")
        properties.append(
            Property(
                id=f"prop:{qn}/{member}",
                name=member,
                type=raw,
                is_collection=is_collection,
                nullable=bool(mspec.get("$Nullable", True)),
                is_key=member in key_set,
                max_length=max_length if isinstance(max_length, int) else None,
                precision=mspec.get("$Precision") if isinstance(mspec.get("$Precision"), int) else None,
                scale=mspec.get("$Scale") if isinstance(mspec.get("$Scale"), (int, str)) else None,
                default_value=None if mspec.get("$DefaultValue") is None else str(mspec.get("$DefaultValue")),
                unicode=mspec.get("$Unicode") if isinstance(mspec.get("$Unicode"), bool) else None,
                srid=None if mspec.get("$SRID") is None else str(mspec.get("$SRID")),
                label=_label(annotations),
                description=_description(annotations),
                annotations=annotations,
            )
        )
    annotations = _json_annotations(spec, ctx)
    common: dict[str, Any] = {
        "name": name,
        "namespace": ns,
        "qualified_name": qn,
        "base_type": ctx.qualify(spec.get("$BaseType")),
        "abstract": bool(spec.get("$Abstract", False)),
        "open_type": bool(spec.get("$OpenType", False)),
        "properties": properties,
        "navigation_properties": navs,
        "label": _label(annotations),
        "description": _description(annotations),
        "annotations": annotations,
    }
    if entity:
        return EntityType(id=f"type:{qn}", key=key, has_stream=bool(spec.get("$HasStream", False)), **common)
    return ComplexType(id=f"complex:{qn}", **common)


def _json_operation(name: str, ns: str, spec: dict[str, Any], index: int, ctx: _Context) -> Operation:
    qn = f"{ns}.{name}"
    params = []
    for p in spec.get("$Parameter", []) or []:
        raw, is_collection = _json_type(p, ctx)
        params.append(
            Parameter(
                name=p.get("$Name", "?"),
                type=raw,
                is_collection=is_collection,
                nullable=bool(p.get("$Nullable", True)),
                max_length=p.get("$MaxLength") if isinstance(p.get("$MaxLength"), int) else None,
                annotations=_json_annotations(p, ctx),
            )
        )
    rt_spec = spec.get("$ReturnType")
    return_type = None
    if isinstance(rt_spec, dict):
        raw, is_collection = _json_type(rt_spec, ctx)
        return_type = ReturnType(
            type=raw, is_collection=is_collection, nullable=bool(rt_spec.get("$Nullable", True))
        )
    is_bound = bool(spec.get("$IsBound", False))
    annotations = _json_annotations(spec, ctx)
    return Operation(
        id=f"op:{qn}#{index}",
        kind="function" if spec.get("$Kind") == "Function" else "action",
        name=name,
        namespace=ns,
        qualified_name=qn,
        is_bound=is_bound,
        bound_to=params[0].type if is_bound and params else None,
        is_composable=bool(spec.get("$IsComposable", False)),
        entity_set_path=spec.get("$EntitySetPath"),
        parameters=params,
        return_type=return_type,
        label=_label(annotations),
        description=_description(annotations),
        annotations=annotations,
    )


def _json_container(
    name: str, ns: str, spec: dict[str, Any], ctx: _Context, default_qn: str | None
) -> EntityContainer:
    qn = f"{ns}.{name}"
    sets, singletons, imports = [], [], []
    for member, mspec in spec.items():
        if member.startswith("$") or member.startswith("@") or not isinstance(mspec, dict):
            continue
        annotations = _json_annotations(mspec, ctx)
        bindings = [
            NavigationBinding(path=p, target=t)
            for p, t in (mspec.get("$NavigationPropertyBinding") or {}).items()
        ]
        if "$Function" in mspec or "$Action" in mspec:
            is_function = "$Function" in mspec
            imports.append(
                OperationImport(
                    id=f"import:{qn}/{member}",
                    kind="function_import" if is_function else "action_import",
                    name=member,
                    operation=ctx.qualify(mspec.get("$Function") or mspec.get("$Action")) or "",
                    entity_set=mspec.get("$EntitySet"),
                    include_in_service_document=bool(mspec.get("$IncludeInServiceDocument", not is_function)),
                    annotations=annotations,
                )
            )
        elif mspec.get("$Collection", False) or mspec.get("$Kind") == "EntitySet":
            sets.append(
                EntitySet(
                    id=f"set:{qn}/{member}",
                    name=member,
                    entity_type=ctx.qualify(mspec.get("$Type")) or "",
                    navigation_bindings=bindings,
                    include_in_service_document=bool(mspec.get("$IncludeInServiceDocument", True)),
                    label=_label(annotations),
                    description=_description(annotations),
                    annotations=annotations,
                )
            )
        elif "$Type" in mspec:
            singletons.append(
                Singleton(
                    id=f"singleton:{qn}/{member}",
                    name=member,
                    entity_type=ctx.qualify(mspec.get("$Type")) or "",
                    navigation_bindings=bindings,
                    annotations=annotations,
                )
            )
    return EntityContainer(
        id=f"container:{qn}",
        name=name,
        namespace=ns,
        qualified_name=qn,
        extends=ctx.qualify(spec.get("$Extends")),
        is_default=(default_qn is None or default_qn == qn),
        entity_sets=sets,
        singletons=singletons,
        operation_imports=imports,
        annotations=_json_annotations(spec, ctx),
    )


def parse_metadata_json(data: bytes) -> ServiceModel:
    try:
        return _parse_metadata_json(data)
    except MetadataError:
        raise
    except (RecursionError, AttributeError, TypeError, KeyError, ValueError) as exc:
        # Valid JSON in an unexpected shape ("$Reference": [1]) or nested too deeply:
        # the visitor's document is at fault, not the server.
        raise MetadataError(
            "Not a valid CSDL JSON document: a member is nested too deeply or has an unexpected type."
        ) from exc


def _parse_metadata_json(data: bytes) -> ServiceModel:
    try:
        doc = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MetadataError(f"Not valid JSON: {exc}") from exc
    if not isinstance(doc, dict):
        raise MetadataError("A CSDL JSON document must be a JSON object.")
    if "value" in doc and "$Version" not in doc:
        raise MetadataError(
            "This is the OData service document (list of entity sets), not the metadata. "
            "Append /$metadata to the URL."
        )
    if "$Version" not in doc:
        raise MetadataError('Not a CSDL JSON document: the top-level "$Version" member is missing.')
    raw_version = str(doc.get("$Version"))
    version = "4.01" if raw_version.startswith("4.01") else "4.0"
    ctx = _Context(version=version)
    references: list[Reference] = []
    for uri, ref in (doc.get("$Reference") or {}).items():
        includes = []
        for inc in ref.get("$Include", []) or []:
            ns, alias = inc.get("$Namespace", ""), inc.get("$Alias")
            includes.append(ReferenceInclude(namespace=ns, alias=alias))
            if alias and ns:
                ctx.aliases[alias] = ns
        references.append(Reference(uri=uri, includes=includes))
    schema_specs = {k: v for k, v in doc.items() if not k.startswith("$") and isinstance(v, dict)}
    if not schema_specs:
        raise MetadataError("The CSDL JSON document contains no schema.")
    for ns, spec in schema_specs.items():
        if spec.get("$Alias"):
            ctx.aliases[spec["$Alias"]] = ns
    default_container = ctx.qualify(doc.get("$EntityContainer"))
    schemas: list[Schema] = []
    for ns, spec in schema_specs.items():
        schema = Schema(id=f"schema:{ns}", namespace=ns, alias=spec.get("$Alias"))
        for name, member in spec.items():
            if name.startswith("$") or name.startswith("@"):
                continue
            if isinstance(member, list):
                for i, overload in enumerate(member):
                    if isinstance(overload, dict) and overload.get("$Kind") in ("Function", "Action"):
                        op = _json_operation(name, ns, overload, i, ctx)
                        schema.operations.append(op)
                        ctx.index.setdefault(op.qualified_name, op)
                continue
            if not isinstance(member, dict):
                continue
            kind = member.get("$Kind")
            if kind == "EntityType":
                et = _json_structured(name, ns, member, ctx, entity=True)
                schema.entity_types.append(et)
                ctx.index[et.qualified_name] = et
                ctx.entity_types[et.qualified_name] = et
            elif kind == "ComplexType":
                ct = _json_structured(name, ns, member, ctx, entity=False)
                schema.complex_types.append(ct)
                ctx.index[ct.qualified_name] = ct
            elif kind == "EnumType":
                qn = f"{ns}.{name}"
                members = [
                    EnumMember(
                        name=m,
                        value=v if isinstance(v, int) else None,
                        label=_label(_json_annotations(member, ctx, m)),
                    )
                    for m, v in member.items()
                    if not m.startswith("$") and "@" not in m
                ]
                annotations = _json_annotations(member, ctx)
                en = EnumType(
                    id=f"enum:{qn}",
                    name=name,
                    namespace=ns,
                    qualified_name=qn,
                    underlying_type=ctx.qualify(member.get("$UnderlyingType")) or "Edm.Int32",
                    is_flags=bool(member.get("$IsFlags", False)),
                    members=members,
                    label=_label(annotations),
                    description=_description(annotations),
                    annotations=annotations,
                )
                schema.enum_types.append(en)
                ctx.index[qn] = en
            elif kind == "TypeDefinition":
                qn = f"{ns}.{name}"
                annotations = _json_annotations(member, ctx)
                td = TypeDefinition(
                    id=f"typedef:{qn}",
                    name=name,
                    namespace=ns,
                    qualified_name=qn,
                    underlying_type=ctx.qualify(member.get("$UnderlyingType")) or "Edm.String",
                    max_length=member.get("$MaxLength")
                    if isinstance(member.get("$MaxLength"), int)
                    else None,
                    precision=member.get("$Precision") if isinstance(member.get("$Precision"), int) else None,
                    scale=member.get("$Scale") if isinstance(member.get("$Scale"), (int, str)) else None,
                    label=_label(annotations),
                    description=_description(annotations),
                    annotations=annotations,
                )
                schema.type_definitions.append(td)
                ctx.index[qn] = td
            elif kind == "EntityContainer":
                container = _json_container(name, ns, member, ctx, default_container)
                schema.containers.append(container)
                ctx.index[container.qualified_name] = container
                for s in container.entity_sets:
                    ctx.index[f"{container.qualified_name}/{s.name}"] = s
        schema.annotations = _json_annotations(spec, ctx)
        schemas.append(schema)
    extra = 0
    for spec in schema_specs.values():
        for target, anns in (spec.get("$Annotations") or {}).items():
            node = _resolve_target(ctx.qualify(target) or target, ctx)
            if node is None or not isinstance(anns, dict):
                ctx.unresolved[f"annotation target {target}"] += 1
                continue
            parsed = _json_annotations(anns, ctx)
            node.annotations.extend(parsed)
            extra += len(parsed)
            if getattr(node, "label", None) is None and hasattr(node, "label"):
                node.label = _label(node.annotations)
            if getattr(node, "description", None) is None and hasattr(node, "description"):
                node.description = _description(node.annotations)
    model = ServiceModel(
        filename="",
        source="",
        format="json",
        odata_version=version,  # type: ignore[arg-type]
        edmx_version=raw_version,
        schemas=schemas,
        references=references,
        default_container=default_container,
    )
    _finish(model, ctx, extra_annotations=extra)
    return model


# ---------------------------------------------------------------------------
# Shared finishing: inherited keys, default container, stats, notices
# ---------------------------------------------------------------------------


def _finish(model: ServiceModel, ctx: _Context, *, extra_annotations: int) -> None:
    # Keys are inherited from the base type.
    for et in ctx.entity_types.values():
        if et.key:
            continue
        base, seen = et.base_type, set()
        while base and base not in seen:
            seen.add(base)
            parent = ctx.entity_types.get(base)
            if parent is None:
                break
            if parent.key:
                et.key = list(parent.key)
                et.key_inherited = True
                break
            base = parent.base_type
    # Partner multiplicities (V4): the far end tells how many of *us* it sees.
    for et in list(ctx.entity_types.values()) + [ct for s in model.schemas for ct in s.complex_types]:
        for nav in et.navigation_properties:
            if nav.source_multiplicity is None and nav.partner:
                target = ctx.entity_types.get(nav.target_type)
                partner = (
                    next((n for n in target.navigation_properties if n.name == nav.partner), None)
                    if target
                    else None
                )
                if partner is not None:
                    nav.source_multiplicity = partner.multiplicity
    # Default container
    if model.default_container is None:
        containers = [c for s in model.schemas for c in s.containers]
        default = next((c for c in containers if c.is_default), containers[0] if containers else None)
        if default is not None:
            model.default_container = default.qualified_name
            for c in containers:
                c.is_default = c is default
    # Dangling type references become notices, not errors.
    known = set(ctx.index)
    for s in model.schemas:
        for st in list(s.entity_types) + list(s.complex_types):
            for nav in st.navigation_properties:
                if nav.target_type and nav.target_type not in known:
                    ctx.unresolved[f"type {nav.target_type}"] += 1
            if st.base_type and st.base_type not in known:
                ctx.unresolved[f"base type {st.base_type}"] += 1
        for c in s.containers:
            for es in c.entity_sets:
                if es.entity_type and es.entity_type not in known:
                    ctx.unresolved[f"type {es.entity_type}"] += 1
    for what, count in sorted(ctx.unresolved.items()):
        suffix = f" ({count}×)" if count > 1 else ""
        ctx.notices.append(f"Unresolved reference to {what}{suffix}; it is shown by name only.")
    if len(ctx.notices) > 12:
        extra = len(ctx.notices) - 12
        ctx.notices = ctx.notices[:12] + [f"… and {extra} more notices."]
    model.notices.extend(ctx.notices)
    model.stats = _stats(model, extra_annotations)


def _stats(model: ServiceModel, extra_annotations: int) -> ServiceStats:
    stats = ServiceStats(schema_count=len(model.schemas), annotation_count=extra_annotations)
    for s in model.schemas:
        stats.entity_type_count += len(s.entity_types)
        stats.complex_type_count += len(s.complex_types)
        stats.enum_type_count += len(s.enum_types)
        stats.type_definition_count += len(s.type_definitions)
        stats.operation_count += len(s.operations)
        for st in list(s.entity_types) + list(s.complex_types):
            stats.property_count += len(st.properties)
            stats.navigation_count += len(st.navigation_properties)
            stats.annotation_count += len(st.annotations) + sum(len(p.annotations) for p in st.properties)
        for c in s.containers:
            stats.entity_set_count += len(c.entity_sets)
            stats.singleton_count += len(c.singletons)
            stats.operation_count += len(c.operations)
    return stats


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


@dataclass
class ParsedMetadata:
    model: ServiceModel
    text: str
    """The document as text (UTF-8 decoded), for the source view."""


MINIFIED_AVG_LINE_LENGTH = 400


def _pretty_print_if_minified(data: bytes) -> tuple[bytes, bool]:
    """Services usually serve ``$metadata`` as one endless line. Indent it so the
    source view has real lines to show and ``sourceline`` numbers mean something."""
    lines = data.count(b"\n") + 1
    if len(data) < 2048 or len(data) / lines < MINIFIED_AVG_LINE_LENGTH:
        return data, False
    root = _parse_xml_root(data)
    return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding="UTF-8"), True


def parse_metadata(data: bytes, *, content_type: str | None = None) -> ParsedMetadata:
    """Parse CSDL XML or JSON from raw bytes.

    ``content_type`` only breaks ties for ambiguous input; the bytes decide.
    """
    head = data.lstrip(b"\xef\xbb\xbf \t\r\n")
    is_json = (
        head.startswith(b"{")
        or (content_type or "").split(";")[0].strip().endswith("json")
        and not head.startswith(b"<")
    )
    reformatted = False
    if is_json:
        model = parse_metadata_json(data)
    else:
        data, reformatted = _pretty_print_if_minified(data)
        model, _root = parse_metadata_xml(data)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    model.source_bytes = len(data)
    model.source_lines = text.count("\n") + 1
    model.source_reformatted = reformatted
    return ParsedMetadata(model=model, text=text)
