import { describe, expect, it } from "vitest";
import { baseChain, buildIndex, effectiveMembers, operationsBoundTo, primarySet, shortType, stripCollection } from "../src/lib/modelIndex";
import { buildGraph } from "../src/components/DiagramView/buildGraph";
import { buildTreeRows, expandableIds } from "../src/components/ModelTree/treeRows";
import { buildHash, readHash, shareLink } from "../src/lib/deepLink";
import { sampleModel } from "./fixtures/sampleModel";

describe("modelIndex", () => {
  const index = buildIndex(sampleModel);

  it("indexes every node by id with its ancestor path", () => {
    const person = index.byId.get("type:Trip.Person");
    expect(person?.kind).toBe("entity");
    expect(person?.path).toEqual(["schema:Trip", "group:schema:Trip/entity_types"]);
    const prop = index.byId.get("prop:Trip.Person/UserName");
    expect(prop?.owner?.name).toBe("Person");
    expect(prop?.path).toEqual(["schema:Trip", "group:schema:Trip/entity_types", "type:Trip.Person"]);
    expect(index.byId.get("set:Trip.Container/People")?.qualifiedName).toBe("Trip.Container/People");
  });

  it("knows reverse relations", () => {
    expect(index.setsByType.get("Trip.Person")?.map((s) => s.name)).toEqual(["People", "Me"]);
    expect(index.derivedTypes.get("Trip.Person")?.map((t) => t.name)).toEqual(["Manager"]);
    expect(operationsBoundTo(index, "Trip.Person").map((o) => o.name)).toEqual(["GetFriends"]);
    expect(index.usedBy.get("Trip.Location")?.map((t) => t.name)).toEqual(["Person"]);
    expect(primarySet(index, "Trip.Person")?.name).toBe("People");
  });

  it("walks the inheritance chain for members", () => {
    const manager = index.typesByName.get("Trip.Manager");
    if (!manager || manager.kind !== "entity") throw new Error("fixture");
    expect(baseChain(index, manager).map((t) => t.name)).toEqual(["Person"]);
    const members = effectiveMembers(index, manager);
    expect(members.properties.map((p) => p.name)).toEqual(["Budget", "UserName", "Address"]);
    expect(members.navigations.map((n) => n.name)).toEqual(["DirectReports", "Friends", "Trips"]);
  });

  it("shortens type names", () => {
    expect(shortType("Edm.String")).toBe("Edm.String");
    expect(shortType("Trip.Person")).toBe("Person");
    expect(shortType("Collection(Trip.Person)")).toBe("Collection(Person)");
    expect(stripCollection("Collection(X.Y)")).toEqual({ base: "X.Y", collection: true });
  });
});

describe("treeRows", () => {
  const index = buildIndex(sampleModel);

  it("shows only expanded branches", () => {
    const collapsed = buildTreeRows(sampleModel, index, new Set());
    expect(collapsed.map((r) => r.id)).toEqual(["schema:Trip"]);
    const open = buildTreeRows(sampleModel, index, new Set(["schema:Trip", "container:Trip.Container", "group:container:Trip.Container/entity_sets"]));
    const ids = open.map((r) => r.id);
    expect(ids).toContain("set:Trip.Container/People");
    expect(ids).toContain("group:schema:Trip/entity_types");
    expect(ids).not.toContain("type:Trip.Person");
  });

  it("lists properties with key markers under an expanded type", () => {
    const rows = buildTreeRows(sampleModel, index, new Set(["schema:Trip", "group:schema:Trip/entity_types", "type:Trip.Person"]));
    const userName = rows.find((r) => r.id === "prop:Trip.Person/UserName");
    expect(userName?.isKey).toBe(true);
    const friends = rows.find((r) => r.id === "nav:Trip.Person/Friends");
    expect(friends?.secondary).toBe("Person (* → *)");
    expect(expandableIds(sampleModel)).toContain("type:Trip.Person");
  });
});

describe("buildGraph", () => {
  const index = buildIndex(sampleModel);

  it("draws one edge per relationship and inheritance", () => {
    const graph = buildGraph(index, { showProperties: true, showComplexTypes: false, focusId: null, maxNodes: 100 });
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["type:Trip.Manager", "type:Trip.Person", "type:Trip.Trip"]);
    const kinds = graph.edges.map((e) => e.kind).sort();
    expect(kinds).toEqual(["inheritance", "navigation", "navigation", "navigation"]);
    const friends = graph.edges.find((e) => e.id === "e:nav:Trip.Person/Friends");
    expect(friends?.bidirectional).toBe(true);
    expect(friends?.label).toBe("Friends / Friends");
    expect(graph.edges.filter((e) => e.label?.startsWith("Friends")).length).toBe(1);
    expect(graph.omitted).toBe(0);
  });

  it("focus keeps the type and its neighbours; complex types are optional", () => {
    const focused = buildGraph(index, { showProperties: false, showComplexTypes: true, focusId: "type:Trip.Trip", maxNodes: 100 });
    expect(focused.nodes.map((n) => n.id).sort()).toEqual(["type:Trip.Person", "type:Trip.Trip"]);
    expect(focused.nodes[0].rows).toEqual([]);
    const withComplex = buildGraph(index, { showProperties: true, showComplexTypes: true, focusId: null, maxNodes: 100 });
    expect(withComplex.nodes.map((n) => n.id)).toContain("complex:Trip.Location");
    expect(withComplex.edges.some((e) => e.kind === "composition" && e.label === "Address")).toBe(true);
  });

  it("caps the node count by connectivity", () => {
    const capped = buildGraph(index, { showProperties: true, showComplexTypes: false, focusId: null, maxNodes: 1 });
    expect(capped.nodes.map((n) => n.id)).toEqual(["type:Trip.Person"]);
    expect(capped.omitted).toBe(2);
  });
});

describe("deepLink", () => {
  it("round-trips selection and view through the hash", () => {
    const hash = buildHash("type:Trip.Person", "diagram");
    expect(hash).toBe("#/id/type%3ATrip.Person?view=diagram");
    expect(readHash(hash)).toEqual({ id: "type:Trip.Person", view: "diagram" });
    expect(readHash("#/id/?view=data")).toEqual({ id: null, view: "data" });
    expect(readHash("#/other")).toEqual({ id: null, view: null });
    expect(readHash("#/id/x?view=bogus").view).toBeNull();
  });

  it("builds share links with the service url", () => {
    const link = shareLink("https://h.example/odata/", "set:C/People", null);
    expect(link).toContain("?url=https%3A%2F%2Fh.example%2Fodata%2F");
    expect(link.endsWith("#/id/set%3AC%2FPeople")).toBe(true);
  });
});
