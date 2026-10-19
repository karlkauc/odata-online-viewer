import { describe, expect, it } from "vitest";
import { buildHash, linkQuery, readHash } from "../src/lib/deepLink";
import { DEFAULT_QUERY } from "../src/stores/appStore";

describe("deep link hash", () => {
  it("round-trips node, view and query options", () => {
    const query = { filter: "Name eq 'O''Neil' and Price gt 5", select: ["Name", "Price"], orderby: "Price desc", top: 10, skip: 20, expand: "Category" };
    const hash = buildHash("set:NS.Container/Products", "data", query);
    expect(hash.startsWith("#/id/set%3ANS.Container%2FProducts?view=data&")).toBe(true);
    expect(readHash(hash)).toEqual({ id: "set:NS.Container/Products", view: "data", query });
  });

  it("reads the links the backend writes for the sample pages", () => {
    const state = readHash("#/id/set%3ATrippin.Container%2FPeople?view=data&top=5&orderby=UserName%20desc");
    expect(state).toEqual({ id: "set:Trippin.Container/People", view: "data", query: { top: 5, orderby: "UserName desc" } });
  });

  it("drops invalid numbers and unknown views", () => {
    expect(readHash("#/id/x?view=nope&top=9999&skip=-1").query).toEqual({});
    expect(readHash("#/id/x?view=nope").view).toBeNull();
    expect(readHash("#other")).toEqual({ id: null, view: null, query: {} });
  });

  it("keeps old links without a query working", () => {
    expect(readHash("#/id/type%3ANS.Person?view=diagram")).toEqual({ id: "type:NS.Person", view: "diagram", query: {} });
    expect(buildHash(null, null)).toBe("");
  });

  it("puts only non-default options into a link", () => {
    expect(linkQuery(DEFAULT_QUERY, DEFAULT_QUERY)).toEqual({});
    expect(linkQuery({ ...DEFAULT_QUERY, filter: "A eq 1", top: 5 }, DEFAULT_QUERY)).toEqual({ filter: "A eq 1", top: 5 });
  });
});
