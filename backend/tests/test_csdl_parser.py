"""CSDL parser: V2 associations, V4 navigation, operations, annotations, JSON, errors."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.odata.csdl_parser import MetadataError, parse_metadata, split_collection
from app.odata.exports import to_markdown, to_mermaid

SAMPLES = Path(__file__).resolve().parent.parent / "app" / "odata" / "samples"


def load(name: str):
    return parse_metadata((SAMPLES / name).read_bytes()).model


def by_name(model, qualified_name: str):
    for schema in model.schemas:
        for item in schema.entity_types + schema.complex_types + schema.enum_types:
            if item.qualified_name == qualified_name:
                return item
    raise AssertionError(f"{qualified_name} not found")


# --- Version detection ------------------------------------------------------


@pytest.mark.parametrize(
    ("sample", "version", "edmx"),
    [
        ("northwind-v2.xml", "2.0", "1.0"),
        ("odata-v2-sample.xml", "2.0", "1.0"),
        ("northwind-v4.xml", "4.0", "4.0"),
        ("trippin-v4.xml", "4.0", "4.0"),
        ("jdbcodata-demo.xml", "4.0", "4.0"),
    ],
)
def test_versions(sample: str, version: str, edmx: str) -> None:
    model = load(sample)
    assert model.odata_version == version
    assert model.edmx_version == edmx
    assert model.format == "xml"
    assert model.source_lines > 50  # minified snapshots are pretty-printed
    assert model.source_reformatted is True


def test_v3_is_detected_from_data_service_version() -> None:
    doc = (
        '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">'
        '<edmx:DataServices m:DataServiceVersion="3.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">'
        '<Schema Namespace="N" xmlns="http://schemas.microsoft.com/ado/2009/11/edm"><EntityType Name="A"><Key><PropertyRef Name="Id"/></Key>'
        '<Property Name="Id" Type="Edm.Int32" Nullable="false"/></EntityType></Schema></edmx:DataServices></edmx:Edmx>'
    )
    model = parse_metadata(doc.encode()).model
    assert model.odata_version == "3.0"
    assert model.data_service_version == "3.0"


# --- V2: associations become navigations with multiplicities -----------------


def test_v2_navigation_resolves_association_ends() -> None:
    model = load("northwind-v2.xml")
    order = by_name(model, "NorthwindModel.Order")
    navs = {n.name: n for n in order.navigation_properties}
    customer = navs["Customer"]
    assert customer.target_type == "NorthwindModel.Customer"
    assert customer.multiplicity == "0..1"
    assert customer.source_multiplicity == "*"
    assert customer.is_collection is False
    assert customer.relationship == "NorthwindModel.FK_Orders_Customers"
    details = navs["Order_Details"]
    assert details.multiplicity == "*" and details.is_collection
    assert details.target_type == "NorthwindModel.Order_Detail"


def test_v2_referential_constraint_on_the_dependent_side() -> None:
    model = load("northwind-v2.xml")
    detail = by_name(model, "NorthwindModel.Order_Detail")
    nav = next(n for n in detail.navigation_properties if n.name == "Order")
    assert [(c.property, c.referenced_property) for c in nav.referential_constraints] == [
        ("OrderID", "OrderID")
    ]
    # The principal side carries no constraint (V4 semantics).
    order = by_name(model, "NorthwindModel.Order")
    nav_back = next(n for n in order.navigation_properties if n.name == "Order_Details")
    assert nav_back.referential_constraints == []


def test_v2_association_sets_become_navigation_bindings() -> None:
    model = load("northwind-v2.xml")
    container = (
        model.schemas[1].containers[0]
        if len(model.schemas) > 1 and model.schemas[1].containers
        else model.schemas[0].containers[0]
    )
    orders = next(s for s in container.entity_sets if s.name == "Orders")
    bindings = {b.path: b.target for b in orders.navigation_bindings}
    assert bindings["Customer"] == "Customers"
    assert bindings["Order_Details"] == "Order_Details"


def test_v2_function_import_and_complex_type() -> None:
    model = load("odata-v2-sample.xml")
    container = model.schemas[0].containers[0]
    assert model.default_container == container.qualified_name
    op = container.operations[0]
    assert (op.name, op.kind, op.http_method) == ("GetProductsByRating", "function_import", "GET")
    assert op.return_type is not None and op.return_type.type == "Collection(ODataDemo.Product)"
    assert op.return_type.is_collection
    assert [(p.name, p.type) for p in op.parameters] == [("rating", "Edm.Int32")]
    supplier = by_name(model, "ODataDemo.Supplier")
    address = next(p for p in supplier.properties if p.name == "Address")
    assert address.type == "ODataDemo.Address"
    assert by_name(model, "ODataDemo.Address").kind == "complex"
    # m:FC_* feed-customisation attributes survive as annotations.
    product = by_name(model, "ODataDemo.Product")
    name = next(p for p in product.properties if p.name == "Name")
    assert any(a.term == "m:FC_TargetPath" and a.value == "SyndicationTitle" for a in name.annotations)


def test_sap_annotations_give_labels() -> None:
    doc = (
        '<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:sap="http://www.sap.com/Protocols/SAPData">'
        '<edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">'
        '<Schema Namespace="Z" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">'
        '<EntityType Name="Sales" sap:content-version="1" sap:label="Sales orders"><Key><PropertyRef Name="Id"/></Key>'
        '<Property Name="Id" Type="Edm.String" Nullable="false" MaxLength="10" sap:label="Order number" sap:quickinfo="Sales order id"/>'
        "</EntityType>"
        '<EntityContainer Name="C" m:IsDefaultEntityContainer="true"><EntitySet Name="SalesSet" EntityType="Z.Sales" sap:creatable="false"/></EntityContainer>'
        "</Schema></edmx:DataServices></edmx:Edmx>"
    )
    model = parse_metadata(doc.encode()).model
    sales = by_name(model, "Z.Sales")
    assert sales.label == "Sales orders"
    prop = sales.properties[0]
    assert (prop.label, prop.description, prop.max_length, prop.is_key) == (
        "Order number",
        "Sales order id",
        10,
        True,
    )
    entity_set = model.schemas[0].containers[0].entity_sets[0]
    assert any(a.term == "sap:creatable" and a.value == "false" for a in entity_set.annotations)
    assert model.schemas[0].containers[0].is_default


# --- V4 ---------------------------------------------------------------------


def test_v4_navigation_partner_and_multiplicity() -> None:
    model = load("northwind-v4.xml")
    category = by_name(model, "NorthwindModel.Category")
    products = category.navigation_properties[0]
    assert (products.name, products.target_type, products.multiplicity) == (
        "Products",
        "NorthwindModel.Product",
        "*",
    )
    assert products.partner == "Category"
    # The partner's multiplicity tells how many categories a product has.
    assert products.source_multiplicity == "0..1"


def test_v4_enum_complex_operations_and_imports() -> None:
    model = load("trippin-v4.xml")
    gender = by_name(model, "Trippin.PersonGender")
    assert gender.kind == "enum"
    assert [m.name for m in gender.members] == ["Male", "Female", "Unknown"]
    assert [m.value for m in gender.members] == [0, 1, 2]
    person = by_name(model, "Trippin.Person")
    assert person.key == ["UserName"]
    address = next(p for p in person.properties if p.name == "AddressInfo")
    assert address.type == "Collection(Trippin.Location)" and address.is_collection
    features = next(p for p in person.properties if p.name == "Features")
    assert features.type == "Collection(Trippin.Feature)"
    schema = model.schemas[0]
    ops = {op.name: op for op in schema.operations}
    get_friends = ops["GetFriendsTrips"]
    assert get_friends.kind == "function" and get_friends.is_bound
    assert get_friends.bound_to == "Trippin.Person"
    assert get_friends.return_type is not None and get_friends.return_type.type == "Collection(Trippin.Trip)"
    share_trip = ops["ShareTrip"]
    assert share_trip.kind == "action" and share_trip.is_bound
    container = schema.containers[0]
    imports = {i.name: i for i in container.operation_imports}
    assert imports["GetNearestAirport"].kind == "function_import"
    assert imports["GetNearestAirport"].operation == "Trippin.GetNearestAirport"
    assert imports["ResetDataSource"].kind == "action_import"
    people = next(s for s in container.entity_sets if s.name == "People")
    bindings = {b.path: b.target for b in people.navigation_bindings}
    assert bindings["BestFriend"] == "People" and bindings["Friends"] == "People"
    assert model.stats.entity_type_count == 10
    assert model.stats.enum_type_count == 2


def test_v4_inheritance_inherits_the_key() -> None:
    model = load("trippin-v4.xml")
    manager = by_name(model, "Trippin.Manager")
    assert manager.base_type == "Trippin.Person"
    assert manager.key == ["UserName"] and manager.key_inherited


def test_v4_alias_and_external_annotations() -> None:
    doc = """<?xml version="1.0"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:Reference Uri="https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.xml">
    <edmx:Include Namespace="Org.OData.Core.V1" Alias="Core"/>
  </edmx:Reference>
  <edmx:DataServices>
    <Schema Namespace="My.Long.Namespace" Alias="Self" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="A"><Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id" Type="Edm.Int32" Nullable="false">
          <Annotation Term="Core.Description" String="Primary key"/>
        </Property>
        <NavigationProperty Name="Bs" Type="Collection(Self.B)" Partner="A"/>
      </EntityType>
      <EntityType Name="B"><Key><PropertyRef Name="Id"/></Key>
        <Property Name="Id" Type="Edm.Int32" Nullable="false"/>
        <Property Name="AId" Type="Edm.Int32"/>
        <NavigationProperty Name="A" Type="Self.A" Nullable="false" Partner="Bs">
          <ReferentialConstraint Property="AId" ReferencedProperty="Id"/>
        </NavigationProperty>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="As" EntityType="Self.A"><NavigationPropertyBinding Path="Bs" Target="Bs"/></EntitySet>
        <EntitySet Name="Bs" EntityType="Self.B"/>
      </EntityContainer>
      <Annotations Target="Self.A">
        <Annotation Term="Core.Description" String="An A"/>
        <Annotation Term="Core.LongDescription"><String>Long text</String></Annotation>
      </Annotations>
      <Annotations Target="Self.Container/As">
        <Annotation Term="Capabilities.InsertRestrictions"><Record><PropertyValue Property="Insertable" Bool="false"/></Record></Annotation>
      </Annotations>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""
    model = parse_metadata(doc.encode()).model
    a = by_name(model, "My.Long.Namespace.A")
    assert a.navigation_properties[0].target_type == "My.Long.Namespace.B"
    assert a.description == "An A"
    assert a.properties[0].description == "Primary key"
    assert any(
        a_.term == "Org.OData.Core.V1.LongDescription" and a_.value == "Long text" for a_ in a.annotations
    )
    b = by_name(model, "My.Long.Namespace.B")
    nav = b.navigation_properties[0]
    assert nav.multiplicity == "1" and nav.source_multiplicity == "*"
    assert nav.referential_constraints[0].property == "AId"
    entity_set = model.schemas[0].containers[0].entity_sets[0]
    assert any(
        x.term == "Org.OData.Capabilities.V1.InsertRestrictions" and x.value == "{Insertable}"
        for x in entity_set.annotations
    )
    assert model.references[0].includes[0].alias == "Core"
    assert model.notices == []


def test_unresolved_reference_is_a_notice_not_an_error() -> None:
    doc = (
        '<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices>'
        '<Schema Namespace="N" xmlns="http://docs.oasis-open.org/odata/ns/edm">'
        '<EntityType Name="A"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.Int32"/>'
        '<NavigationProperty Name="Ghost" Type="N.Missing"/></EntityType>'
        "</Schema></edmx:DataServices></edmx:Edmx>"
    )
    model = parse_metadata(doc.encode()).model
    assert model.notices and "N.Missing" in model.notices[0]


# --- CSDL JSON --------------------------------------------------------------


CSDL_JSON = {
    "$Version": "4.01",
    "$EntityContainer": "Trip.Container",
    "$Reference": {
        "https://example.org/Core.json": {"$Include": [{"$Namespace": "Org.OData.Core.V1", "$Alias": "Core"}]}
    },
    "Trip": {
        "$Alias": "T",
        "Gender": {"$Kind": "EnumType", "Male": 0, "Female": 1},
        "Location": {"$Kind": "ComplexType", "Address": {}, "City": {"$Nullable": True}},
        "Person": {
            "$Kind": "EntityType",
            "$Key": ["UserName"],
            "UserName": {"$Nullable": False, "@Core.Description": "Login"},
            "Age": {"$Type": "Edm.Int64"},
            "Gender": {"$Type": "T.Gender"},
            "Addresses": {"$Type": "T.Location", "$Collection": True},
            "Friends": {
                "$Kind": "NavigationProperty",
                "$Type": "T.Person",
                "$Collection": True,
                "$Partner": "Friends",
            },
            "Boss": {
                "$Kind": "NavigationProperty",
                "$Type": "T.Person",
                "$Nullable": True,
                "$ReferentialConstraint": {"BossId": "UserName"},
            },
        },
        "GetAge": [
            {
                "$Kind": "Function",
                "$IsBound": True,
                "$Parameter": [{"$Name": "person", "$Type": "T.Person"}],
                "$ReturnType": {"$Type": "Edm.Int64"},
            }
        ],
        "Reset": [{"$Kind": "Action"}],
        "Container": {
            "$Kind": "EntityContainer",
            "People": {
                "$Collection": True,
                "$Type": "T.Person",
                "$NavigationPropertyBinding": {"Friends": "People"},
            },
            "Me": {"$Type": "T.Person"},
            "ResetImport": {"$Action": "T.Reset"},
        },
        "$Annotations": {"T.Person": {"@Core.Description": "A person"}},
    },
}


def test_csdl_json_round_trip() -> None:
    model = parse_metadata(json.dumps(CSDL_JSON).encode()).model
    assert model.format == "json"
    assert model.odata_version == "4.01"
    assert model.default_container == "Trip.Container"
    person = by_name(model, "Trip.Person")
    assert person.key == ["UserName"]
    assert person.description == "A person"
    props = {p.name: p for p in person.properties}
    assert props["UserName"].type == "Edm.String" and props["UserName"].nullable is False
    assert props["UserName"].description == "Login"
    assert props["Gender"].type == "Trip.Gender"
    assert props["Addresses"].type == "Collection(Trip.Location)"
    navs = {n.name: n for n in person.navigation_properties}
    assert navs["Friends"].multiplicity == "*" and navs["Friends"].source_multiplicity == "*"
    assert navs["Boss"].referential_constraints[0].referenced_property == "UserName"
    gender = by_name(model, "Trip.Gender")
    assert [(m.name, m.value) for m in gender.members] == [("Male", 0), ("Female", 1)]
    schema = model.schemas[0]
    assert schema.alias == "T"
    ops = {op.name: op for op in schema.operations}
    assert ops["GetAge"].is_bound and ops["GetAge"].bound_to == "Trip.Person"
    assert ops["Reset"].kind == "action"
    container = schema.containers[0]
    assert container.entity_sets[0].navigation_bindings[0].target == "People"
    assert container.singletons[0].name == "Me"
    assert container.operation_imports[0].kind == "action_import"
    assert model.references[0].includes[0].namespace == "Org.OData.Core.V1"


# --- Errors -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "needle"),
    [
        (b"<!doctype html><html><body>Login</body></html>", "HTML page"),
        (b'<service xmlns="http://www.w3.org/2007/app"><workspace/></service>', "service document"),
        (b'<feed xmlns="http://www.w3.org/2005/Atom"/>', "Atom feed"),
        (b"<root/>", "root element is <root>"),
        (b'{"value": [{"name": "Products", "url": "Products"}]}', "service document"),
        (b'{"foo": 1}', "$Version"),
        (b"<a><b></a>", "line"),
        (b'<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"/>', "DataServices"),
    ],
)
def test_error_messages(data: bytes, needle: str) -> None:
    with pytest.raises(MetadataError) as caught:
        parse_metadata(data)
    assert needle in str(caught.value)


def test_split_collection() -> None:
    assert split_collection("Collection(NS.T)") == ("NS.T", True)
    assert split_collection(" Edm.String ") == ("Edm.String", False)


# --- Exports ----------------------------------------------------------------


def test_markdown_and_mermaid_exports() -> None:
    model = load("northwind-v4.xml")
    md = to_markdown(model)
    assert "### Entity type `Order`" in md
    assert "| `OrderID` | `Edm.Int32` | no | 🔑 |" in md
    mermaid = to_mermaid(model)
    assert mermaid.startswith("erDiagram")
    assert "NorthwindModel_Category" in mermaid
    assert "}o" in mermaid and ": Products" in mermaid
