import { describe, expect, it } from "vitest";
import { drillPath, keyLiteral, localResult, pathSegments, resolvePath } from "../src/lib/drillPath";
import { buildIndex } from "../src/lib/modelIndex";
import { sampleModel } from "./fixtures/sampleModel";

describe("drillPath", () => {
  const index = buildIndex(sampleModel);
  const root = "https://example.org/svc/";

  it("splits paths outside key literals", () => {
    expect(pathSegments("People('a/b')/Trips")).toEqual(["People('a/b')", "Trips"]);
  });

  it("resolves sets, keys, navigations and complex properties", () => {
    const at = (path: string) => {
      const t = resolvePath(index, path);
      return [t.type?.name ?? null, t.collection];
    };
    expect(at("People")).toEqual(["Person", true]);
    expect(at("People('x')")).toEqual(["Person", false]);
    expect(at("People('x')/Trips")).toEqual(["Trip", true]);
    expect(at("People('x')/Trips(3)")).toEqual(["Trip", false]);
    expect(at("People('x')/Address")).toEqual(["Location", false]);
    expect(at("Me/Friends")).toEqual(["Person", true]);
    expect(at("People('x')/Nope")).toEqual([null, true]);
  });

  it("writes key literals per type and version", () => {
    expect(keyLiteral(1, "Edm.Int32", true)).toBe("1");
    expect(keyLiteral("O'Brien", "Edm.String", true)).toBe("'O''Brien'");
    expect(keyLiteral("9007199254740993", "Edm.Int64", true)).toBe("9007199254740993");
    expect(keyLiteral(5, "Edm.Int64", false)).toBe("5L");
    expect(keyLiteral("0b1c", "Edm.Guid", true)).toBe("0b1c");
    expect(keyLiteral("0b1c", "Edm.Guid", false)).toBe("guid'0b1c'");
    expect(keyLiteral("2025-03-07T00:00:00.000Z", "Edm.DateTime", false)).toBe("datetime'2025-03-07T00:00:00.000'");
    expect(keyLiteral(null, "Edm.Int32", true)).toBeNull();
  });

  it("addresses a cell through the row's key", () => {
    const row = { UserName: "russell", Trips: [], Address: { City: "Graz" } };
    expect(drillPath(index, root, true, "People", row, "Trips")).toBe("People('russell')/Trips");
    expect(drillPath(index, root, true, "People", row, "Address")).toBe("People('russell')/Address");
    expect(drillPath(index, root, true, "People('x')/Trips", { TripId: 3 }, "TripId")).toBe("People('x')/Trips(3)/TripId");
    // A single entity needs no key of its own.
    expect(drillPath(index, root, true, "Me", { Trips: [] }, "Trips")).toBe("Me/Trips");
  });

  it("gives up without a key or below a complex value", () => {
    expect(drillPath(index, root, true, "People", { Trips: [] }, "Trips")).toBeNull();
    expect(drillPath(index, root, true, "People('x')/Address", { City: "Graz" }, "City")).toBeNull();
  });

  it("follows V2 deferred links on the service only", () => {
    const row = { Trips: { "@link": "https://example.org/svc/People('a%20b')/Trips" } };
    expect(drillPath(index, root, false, "People", row, "Trips")).toBe("People('a b')/Trips");
    expect(drillPath(index, root, false, "People", { Trips: { "@link": "https://evil.example/x" } }, "Trips")).toBeNull();
  });

  it("builds a local table from an inline value", () => {
    expect(localResult(["a", "b"]).rows).toEqual([{ value: "a" }, { value: "b" }]);
    const objects = localResult([{ A: 1 }, { B: 2 }]);
    expect(objects.columns).toEqual(["A", "B"]);
    expect(localResult({ City: "Graz" }).rows).toEqual([{ City: "Graz" }]);
  });
});
