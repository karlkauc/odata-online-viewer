// Layered layout with ELK. The bundled build runs on the main thread, which
// is fine for a few hundred nodes; it is imported lazily so the landing page
// does not pay for it.

import type { Graph } from "./buildGraph";

export interface Positioned {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

type ElkNode = {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
  layoutOptions?: Record<string, string>;
};

let elkPromise: Promise<{ layout: (graph: ElkNode) => Promise<ElkNode> }> | null = null;

function elk() {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled.js").then((mod) => {
      const Elk = (mod.default ?? mod) as unknown as new () => { layout: (graph: ElkNode) => Promise<ElkNode> };
      return new Elk();
    });
  }
  return elkPromise;
}

export async function layoutGraph(graph: Graph, direction: "RIGHT" | "DOWN" = "RIGHT"): Promise<Positioned> {
  if (graph.nodes.length === 0) return { positions: new Map(), width: 0, height: 0 };
  const engine = await elk();
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const result = await engine.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
      "elk.spacing.nodeNode": "40",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: graph.nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: graph.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target)
      .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  const positions = new Map<string, { x: number; y: number }>();
  for (const child of result.children ?? []) positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  return { positions, width: result.width ?? 0, height: result.height ?? 0 };
}
