import { describe, expect, it } from "vitest";
import type { Graph, GraphEdge } from "../src/components/DiagramView/buildGraph";
import { layerGap } from "../src/components/DiagramView/layout";

function graphWith(...labels: [string | null, string | null, string | null][]): Graph {
  const edges = labels.map(
    ([label, sourceLabel, targetLabel], i): GraphEdge => ({
      id: `e${i}`,
      source: "a",
      target: "b",
      kind: "navigation",
      label,
      sourceLabel,
      targetLabel,
      selectId: null,
      bidirectional: false,
    }),
  );
  return { nodes: [], edges, omitted: 0 };
}

describe("layerGap", () => {
  it("keeps the minimum for short or missing labels", () => {
    expect(layerGap(graphWith([null, null, null], ["Tag", "1", "*"]), "RIGHT")).toBe(90);
  });

  it("widens the gap for the widest label and its multiplicities", () => {
    const gap = layerGap(graphWith(["Products / Category", "0..1", "*"]), "RIGHT");
    // label 19 chars + both ends sized for "0..1"
    expect(gap).toBeGreaterThanOrEqual(19 * 6 + 2 * 4 * 6);
    expect(gap).toBeLessThan(280);
  });

  it("is capped so one long name does not spread the whole diagram", () => {
    expect(layerGap(graphWith(["A".repeat(80), "0..1", "0..1"]), "RIGHT")).toBe(280);
  });

  it("ignores labels when layers stack vertically", () => {
    expect(layerGap(graphWith(["Products / Category", "0..1", "*"]), "DOWN")).toBe(90);
  });
});
