"""Annotation.structured: records and collections kept as JSON for the Fiori/Capabilities view."""

from __future__ import annotations

import json

from app.odata import csdl_parser
from app.odata.csdl_parser import parse_metadata

UI = "com.sap.vocabularies.UI.v1"
CAP = "Org.OData.Capabilities.V1"

EDMX = b"""<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:Reference Uri="https://sap.github.io/odata-vocabularies/vocabularies/UI.xml">
    <edmx:Include Namespace="com.sap.vocabularies.UI.v1" Alias="UI"/>
  </edmx:Reference>
  <edmx:DataServices>
    <Schema Namespace="S" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="Book"><Key><PropertyRef Name="ID"/></Key>
        <Property Name="ID" Type="Edm.Int32" Nullable="false"/>
        <Property Name="title" Type="Edm.String"/>
      </EntityType>
      <EntityContainer Name="C"><EntitySet Name="Books" EntityType="S.Book"/></EntityContainer>
      <Annotations Target="S.Book">
        <Annotation Term="UI.LineItem">
          <Collection>
            <Record Type="UI.DataField"><PropertyValue Property="Value" Path="ID"/></Record>
            <Record Type="UI.DataField"><PropertyValue Property="Value" Path="title"/><PropertyValue Property="Label" String="Title"/></Record>
          </Collection>
        </Annotation>
        <Annotation Term="UI.SelectionFields"><Collection><PropertyPath>title</PropertyPath></Collection></Annotation>
        <Annotation Term="UI.HeaderInfo"><Record>
          <PropertyValue Property="TypeName" String="Book"/>
          <PropertyValue Property="Title"><Record Type="UI.DataField"><PropertyValue Property="Value" Path="title"/></Record></PropertyValue>
        </Record></Annotation>
      </Annotations>
      <Annotations Target="S.C/Books">
        <Annotation Term="Capabilities.DeleteRestrictions"><Record><PropertyValue Property="Deletable" Bool="false"/></Record></Annotation>
        <Annotation Term="Capabilities.FilterRestrictions"><Record>
          <PropertyValue Property="NonFilterableProperties"><Collection><PropertyPath>ID</PropertyPath></Collection></PropertyValue>
        </Record></Annotation>
      </Annotations>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>"""


def _by_term(annotations, term):
    return next(a for a in annotations if a.term == term)


def test_xml_records_and_collections_are_kept() -> None:
    model = parse_metadata(EDMX).model
    book = model.schemas[0].entity_types[0]
    line_item = _by_term(book.annotations, f"{UI}.LineItem")
    assert line_item.value == "[2 items]"
    assert line_item.structured == [
        {"$Type": f"{UI}.DataField", "Value": "ID"},
        {"$Type": f"{UI}.DataField", "Value": "title", "Label": "Title"},
    ]
    assert _by_term(book.annotations, f"{UI}.SelectionFields").structured == ["title"]
    header = _by_term(book.annotations, f"{UI}.HeaderInfo").structured
    assert header == {"TypeName": "Book", "Title": {"$Type": f"{UI}.DataField", "Value": "title"}}

    books = model.schemas[0].containers[0].entity_sets[0]
    assert _by_term(books.annotations, f"{CAP}.DeleteRestrictions").structured == {"Deletable": "false"}
    assert _by_term(books.annotations, f"{CAP}.FilterRestrictions").structured == {"NonFilterableProperties": ["ID"]}


def test_primitives_have_no_structure() -> None:
    xml = EDMX.replace(b"</Key>", b'</Key><Annotation Term="Core.Description" String="A book"/>', 1)
    book = parse_metadata(xml).model.schemas[0].entity_types[0]
    assert _by_term(book.annotations, "Org.OData.Core.V1.Description").structured is None


def test_json_annotations_use_the_same_shape() -> None:
    doc = {
        "$Version": "4.01",
        "$Reference": {"https://x/UI.json": {"$Include": [{"$Namespace": UI, "$Alias": "UI"}]}},
        "S": {
            "Book": {"$Kind": "EntityType", "$Key": ["ID"], "ID": {"$Type": "Edm.Int32"}},
            "C": {"$Kind": "EntityContainer", "Books": {"$Collection": True, "$Type": "S.Book"}},
            "$Annotations": {
                "S.Book": {
                    "@UI.LineItem": [{"@type": f"#{UI}.DataField", "Value": {"$Path": "ID"}}],
                    "@UI.SelectionFields": [{"$PropertyPath": "ID"}],
                },
                "S.C/Books": {"@Capabilities.DeleteRestrictions": {"Deletable": False}},
            },
        },
    }
    model = parse_metadata(json.dumps(doc).encode(), content_type="application/json").model
    book = model.schemas[0].entity_types[0]
    assert _by_term(book.annotations, f"{UI}.LineItem").structured == [{"$Type": f"{UI}.DataField", "Value": "ID"}]
    assert _by_term(book.annotations, f"{UI}.SelectionFields").structured == ["ID"]
    books = model.schemas[0].containers[0].entity_sets[0]
    assert _by_term(books.annotations, f"{CAP}.DeleteRestrictions").structured == {"Deletable": "false"}


def test_huge_annotations_are_capped(monkeypatch) -> None:
    monkeypatch.setattr(csdl_parser, "STRUCTURED_MAX_NODES", 2)
    model = parse_metadata(EDMX).model
    line_item = _by_term(model.schemas[0].entity_types[0].annotations, f"{UI}.LineItem").structured
    assert "…" in json.dumps(line_item, ensure_ascii=False)


def test_markdown_export_lists_restrictions_and_line_item() -> None:
    from app.odata.exports import to_markdown

    md = to_markdown(parse_metadata(EDMX).model)
    assert "| `Books` | `S.Book` |  | no delete |" in md
    assert "Fiori list columns (UI.LineItem): `ID`, `title`" in md
