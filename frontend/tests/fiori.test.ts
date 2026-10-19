import { describe, expect, it } from "vitest";
import { capabilities, hasCapabilityInfo, propertyHints, uiSummary } from "../src/lib/fiori";
import type { Annotation, Property } from "../src/types/model";

const UI = "com.sap.vocabularies.UI.v1.";
const CAP = "Org.OData.Capabilities.V1.";

const ann = (term: string, value: string | null, structured: Annotation["structured"] = null, qualifier: string | null = null): Annotation => ({ term, value, structured, qualifier });

function prop(name: string, annotations: Annotation[] = []): Property {
  return { id: `prop:S.T/${name}`, name, type: "Edm.String", is_collection: false, nullable: true, is_key: false, annotations } as unknown as Property;
}

describe("capabilities", () => {
  it("reads V4 Capabilities restrictions", () => {
    const rows = capabilities(
      [
        ann(CAP + "DeleteRestrictions", "{Deletable}", { Deletable: "false" }),
        ann(CAP + "FilterRestrictions", "{NonFilterableProperties}", { NonFilterableProperties: ["ID"], RequiredProperties: ["Year"] }),
        ann(CAP + "TopSupported", "false"),
      ],
      [],
    );
    const by = Object.fromEntries(rows.map((r) => [r.operation, r]));
    expect(by.Delete).toMatchObject({ allowed: false, source: "Capabilities.DeleteRestrictions" });
    expect(by.Create.allowed).toBeNull();
    expect(by.Filter.details).toEqual(["ID: not filterable", "Year: required in $filter"]);
    expect(by["Paging ($top/$skip)"].allowed).toBe(false);
    expect(hasCapabilityInfo(rows)).toBe(true);
  });

  it("falls back to SAP V2 attributes on the set and its properties", () => {
    const rows = capabilities([ann("sap:creatable", "false"), ann("sap:pageable", "true")], [prop("Name", [ann("sap:sortable", "false")])]);
    const by = Object.fromEntries(rows.map((r) => [r.operation, r]));
    expect(by.Create).toMatchObject({ allowed: false, source: "sap:creatable" });
    expect(by["Paging ($top/$skip)"].allowed).toBe(true);
    expect(by.Sort.details).toEqual(["Name: not sortable"]);
  });

  it("reports nothing for an unannotated set", () => {
    expect(hasCapabilityInfo(capabilities([], [prop("A")]))).toBe(false);
  });
});

describe("uiSummary", () => {
  it("summarises header, selection fields and line items", () => {
    const summary = uiSummary([
      ann(UI + "HeaderInfo", "{TypeName}", { TypeName: "Book", TypeNamePlural: "Books", Title: { $Type: UI + "DataField", Value: "title" } }),
      ann(UI + "SelectionFields", "[1 item]", ["title"]),
      ann(UI + "LineItem", "[2 items]", [{ $Type: UI + "DataField", Value: "ID" }, { $Type: UI + "DataFieldForAction", Action: "S.approve", Label: "Approve" }]),
      ann(UI + "FieldGroup", "{Data}", { Label: "Admin", Data: [{ Value: "createdBy" }] }, "Admin"),
    ]);
    expect(summary?.header).toEqual({ typeName: "Book", typeNamePlural: "Books", title: "title", description: null });
    expect(summary?.selectionFields).toEqual(["title"]);
    expect(summary?.lists.map((l) => l.title)).toEqual(["Table columns (UI.LineItem)", "Field group “Admin” (UI.FieldGroup) #Admin"]);
    expect(summary?.lists[0].fields).toEqual([
      { value: "ID", label: null, kind: "DataField" },
      { value: "S.approve", label: "Approve", kind: "DataFieldForAction" },
    ]);
  });

  it("is null without UI annotations", () => {
    expect(uiSummary([ann("Org.OData.Core.V1.Description", "x")])).toBeNull();
  });
});

describe("propertyHints", () => {
  it("collects text, value help and sap flags", () => {
    expect(
      propertyHints([
        ann("com.sap.vocabularies.Common.v1.Text", "CustomerName"),
        ann("com.sap.vocabularies.Common.v1.ValueList", "{CollectionPath}", { CollectionPath: "Customers" }),
        ann("sap:filterable", "false"),
        ann("Org.OData.Core.V1.Computed", "true"),
      ]),
    ).toEqual(["text from CustomerName", "value help: Customers", "not filterable", "computed"]);
  });
});
