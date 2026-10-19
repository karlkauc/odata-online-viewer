"""Version-neutral model of an OData service description (CSDL).

OData V2/V3 (EDMX 1.0) and V4/V4.01 (EDMX 4.0, XML or JSON) describe the same
things with different vocabulary: V2 ``Association``/``AssociationSet`` ends
become V4-style navigation properties with a multiplicity, ``FunctionImport``
becomes an operation, ``sap:``/``m:`` attributes become annotations. The
frontend only ever sees this model, so every view works for every version.

Node ids are stable, human-readable strings (``type:NS.Name``,
``prop:NS.Type/Name``, ``set:NS.Container/Name`` …) shared by the tree, the
diagram, deep links and the search.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ODataVersion = Literal["2.0", "3.0", "4.0", "4.01"]
Multiplicity = Literal["1", "0..1", "*"]


class Annotation(BaseModel):
    """One annotation, stringified. ``term`` is the full term name when it could
    be resolved (``Org.OData.Core.V1.Description``), else what the document said
    (``sap:label``)."""

    term: str
    qualifier: str | None = None
    value: str | None = None
    structured: Any = None
    """Records and collections as JSON — dict (``$Type`` + property values), list,
    or str for primitives and paths — so the UI can read UI.LineItem or
    Capabilities restrictions. Same shape for EDMX and CSDL JSON; ``None`` for
    plain values. Capped (``STRUCTURED_MAX_*`` in csdl_parser) for huge SAP services."""


class Property(BaseModel):
    id: str
    name: str
    type: str
    """Fully qualified type, aliases resolved; ``Collection(…)`` kept."""
    is_collection: bool = False
    nullable: bool = True
    is_key: bool = False
    max_length: int | None = None
    max_length_is_max: bool = False
    precision: int | None = None
    scale: int | str | None = None
    default_value: str | None = None
    unicode: bool | None = None
    srid: str | None = None
    label: str | None = None
    description: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class ReferentialConstraint(BaseModel):
    property: str
    referenced_property: str


class NavigationProperty(BaseModel):
    id: str
    name: str
    target_type: str
    """Qualified entity type at the far end (never ``Collection(…)``)."""
    is_collection: bool
    nullable: bool = True
    multiplicity: Multiplicity
    """Multiplicity of the far end: ``*`` for collections, ``1`` or ``0..1`` otherwise."""
    source_multiplicity: Multiplicity | None = None
    """Multiplicity of this end as seen from the target (V2 association end, V4 partner)."""
    partner: str | None = None
    contains_target: bool = False
    referential_constraints: list[ReferentialConstraint] = Field(default_factory=list)
    relationship: str | None = None
    """V2/V3: qualified name of the ``Association``."""
    on_delete: str | None = None
    label: str | None = None
    description: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class StructuredType(BaseModel):
    id: str
    name: str
    namespace: str
    qualified_name: str
    base_type: str | None = None
    abstract: bool = False
    open_type: bool = False
    properties: list[Property] = Field(default_factory=list)
    navigation_properties: list[NavigationProperty] = Field(default_factory=list)
    label: str | None = None
    description: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class EntityType(StructuredType):
    kind: Literal["entity"] = "entity"
    key: list[str] = Field(default_factory=list)
    key_inherited: bool = False
    has_stream: bool = False


class ComplexType(StructuredType):
    kind: Literal["complex"] = "complex"


class EnumMember(BaseModel):
    name: str
    value: int | None = None
    label: str | None = None


class EnumType(BaseModel):
    id: str
    kind: Literal["enum"] = "enum"
    name: str
    namespace: str
    qualified_name: str
    underlying_type: str = "Edm.Int32"
    is_flags: bool = False
    members: list[EnumMember] = Field(default_factory=list)
    label: str | None = None
    description: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class TypeDefinition(BaseModel):
    id: str
    kind: Literal["typedef"] = "typedef"
    name: str
    namespace: str
    qualified_name: str
    underlying_type: str
    max_length: int | None = None
    precision: int | None = None
    scale: int | str | None = None
    label: str | None = None
    description: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class Parameter(BaseModel):
    name: str
    type: str
    is_collection: bool = False
    nullable: bool = True
    mode: str | None = None
    """V2 ``Mode`` (In/Out/InOut)."""
    max_length: int | None = None
    precision: int | None = None
    scale: int | str | None = None
    annotations: list[Annotation] = Field(default_factory=list)


class ReturnType(BaseModel):
    type: str
    is_collection: bool = False
    nullable: bool = True


OperationKind = Literal["function", "action", "function_import"]


class Operation(BaseModel):
    id: str
    kind: OperationKind
    """V4 ``Function``/``Action``; V2/V3 ``FunctionImport`` (declared in the container)."""
    name: str
    namespace: str
    qualified_name: str
    is_bound: bool = False
    bound_to: str | None = None
    """Binding parameter type of a bound V4 operation (``NS.Type`` or ``Collection(NS.Type)``)."""
    is_composable: bool = False
    entity_set_path: str | None = None
    entity_set: str | None = None
    """V2 ``FunctionImport/@EntitySet``."""
    http_method: str | None = None
    parameters: list[Parameter] = Field(default_factory=list)
    return_type: ReturnType | None = None
    label: str | None = None
    description: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class NavigationBinding(BaseModel):
    path: str
    target: str


class EntitySet(BaseModel):
    id: str
    kind: Literal["set"] = "set"
    name: str
    entity_type: str
    navigation_bindings: list[NavigationBinding] = Field(default_factory=list)
    include_in_service_document: bool = True
    label: str | None = None
    description: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class Singleton(BaseModel):
    id: str
    kind: Literal["singleton"] = "singleton"
    name: str
    entity_type: str
    navigation_bindings: list[NavigationBinding] = Field(default_factory=list)
    label: str | None = None
    description: str | None = None
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class OperationImport(BaseModel):
    id: str
    kind: Literal["function_import", "action_import"]
    name: str
    operation: str
    """Qualified name of the V4 ``Function``/``Action`` it exposes."""
    entity_set: str | None = None
    include_in_service_document: bool = True
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class EntityContainer(BaseModel):
    id: str
    name: str
    namespace: str
    qualified_name: str
    extends: str | None = None
    is_default: bool = True
    entity_sets: list[EntitySet] = Field(default_factory=list)
    singletons: list[Singleton] = Field(default_factory=list)
    operation_imports: list[OperationImport] = Field(default_factory=list)
    operations: list[Operation] = Field(default_factory=list)
    """V2/V3 function imports live in the container."""
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class Schema(BaseModel):
    id: str
    namespace: str
    alias: str | None = None
    entity_types: list[EntityType] = Field(default_factory=list)
    complex_types: list[ComplexType] = Field(default_factory=list)
    enum_types: list[EnumType] = Field(default_factory=list)
    type_definitions: list[TypeDefinition] = Field(default_factory=list)
    operations: list[Operation] = Field(default_factory=list)
    containers: list[EntityContainer] = Field(default_factory=list)
    annotations: list[Annotation] = Field(default_factory=list)
    line: int | None = None


class ReferenceInclude(BaseModel):
    namespace: str
    alias: str | None = None


class Reference(BaseModel):
    uri: str
    includes: list[ReferenceInclude] = Field(default_factory=list)


class ServiceStats(BaseModel):
    schema_count: int = 0
    entity_type_count: int = 0
    complex_type_count: int = 0
    enum_type_count: int = 0
    type_definition_count: int = 0
    entity_set_count: int = 0
    singleton_count: int = 0
    operation_count: int = 0
    property_count: int = 0
    navigation_count: int = 0
    annotation_count: int = 0


class ServiceModel(BaseModel):
    metadata_id: str = ""
    filename: str
    source: str
    """upload | text | url | sample"""
    format: Literal["xml", "json"] = "xml"
    odata_version: ODataVersion
    edmx_version: str | None = None
    data_service_version: str | None = None
    metadata_url: str | None = None
    """The ``$metadata`` URL that was actually fetched (after redirects)."""
    service_root: str | None = None
    """Service root derived from ``metadata_url``; ``None`` for pasted/uploaded documents."""
    auth_used: bool = False
    default_container: str | None = None
    schemas: list[Schema] = Field(default_factory=list)
    references: list[Reference] = Field(default_factory=list)
    stats: ServiceStats = Field(default_factory=ServiceStats)
    notices: list[str] = Field(default_factory=list)
    """Repairs and limitations the visitor should know about (never errors)."""
    source_bytes: int = 0
    source_lines: int = 0
    source_reformatted: bool = False
    """The document arrived minified; it was pretty-printed so line numbers mean something."""
