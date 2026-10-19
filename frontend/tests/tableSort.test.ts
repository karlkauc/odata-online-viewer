import { describe, expect, it } from "vitest";
import { nextSort, orderbyFor, parseOrderby, sortableType, sortRows } from "../src/lib/tableSort";

describe("parseOrderby", () => {
  it("reads the first key and its direction", () => {
    expect(parseOrderby("Name")).toEqual({ column: "Name", dir: "asc" });
    expect(parseOrderby("Name desc")).toEqual({ column: "Name", dir: "desc" });
    expect(parseOrderby("  Name   DESC , Id")).toEqual({ column: "Name", dir: "desc" });
  });

  it("returns null without an orderby", () => {
    expect(parseOrderby(null)).toBeNull();
    expect(parseOrderby("  ")).toBeNull();
  });
});

describe("nextSort", () => {
  it("starts ascending and flips on the same column", () => {
    const first = nextSort(null, "Name");
    expect(first).toEqual({ column: "Name", dir: "asc" });
    const second = nextSort(first, "Name");
    expect(orderbyFor(second)).toBe("Name desc");
    expect(nextSort(second, "Name").dir).toBe("asc");
  });

  it("starts ascending on another column", () => {
    expect(nextSort({ column: "Name", dir: "desc" }, "Id")).toEqual({ column: "Id", dir: "asc" });
  });
});

describe("sortableType", () => {
  it("allows primitives but not streams, binaries, spatial or structured types", () => {
    expect(sortableType("Edm.String")).toBe(true);
    expect(sortableType("Edm.DateTimeOffset")).toBe(true);
    expect(sortableType("Edm.Binary")).toBe(false);
    expect(sortableType("Edm.GeographyPoint")).toBe(false);
    expect(sortableType("Address")).toBe(false);
    expect(sortableType("Collection(Edm.String)")).toBe(false);
  });
});

describe("sortRows", () => {
  const rows = [
    { id: 1, name: "item 10", price: 3 },
    { id: 2, name: "Item 9", price: null },
    { id: 3, name: "item 2", price: 1 },
    { id: 4, name: "item 2", price: 3 },
  ];

  it("compares numbers numerically and keeps nulls last", () => {
    expect(sortRows(rows, { column: "price", dir: "asc" }).map((r) => r.id)).toEqual([3, 1, 4, 2]);
    expect(sortRows(rows, { column: "price", dir: "desc" }).map((r) => r.id)).toEqual([1, 4, 3, 2]);
  });

  it("compares text naturally, case-insensitively and stably", () => {
    expect(sortRows(rows, { column: "name", dir: "asc" }).map((r) => r.id)).toEqual([3, 4, 2, 1]);
  });

  it("does not modify the input", () => {
    sortRows(rows, { column: "price", dir: "asc" });
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
});
