// Entity-relationship graph of a service model: one node per entity type
// (and optionally complex type), one edge per navigation property, plus
// inheritance and complex-type usage edges. Layout is done separately (layout.ts).

import { shortType, stripCollection, type ModelIndex } from "../../lib/modelIndex";
import type { Multiplicity, StructuredType } from "../../types/model";

export interface GraphRow {
  id: string;
  name: string;
  type: string;
  isKey: boolean;
  nullable: boolean;
}

export interface GraphNode {
  id: string;
  type: StructuredType;
  title: string;
  subtitle: string | null;
  rows: GraphRow[];
  hiddenRows: number;
  kind: "entity" | "complex";
  abstract: boolean;
  width: number;
  height: number;
}

export type GraphEdgeKind = "navigation" | "inheritance" | "composition";

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  label: string | null;
  sourceLabel: string | null;
  targetLabel: string | null;
  /** Node id of the navigation property, for selection. */
  selectId: string | null;
  bidirectional: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Types left out because of the focus / size cap. */
  omitted: number;
}

export interface GraphOptions {
  showProperties: boolean;
  showComplexTypes: boolean;
  /** Only this type and its direct neighbours. */
  focusId: string | null;
  /** Hard cap on nodes; the largest connected types win when exceeded. */
  maxNodes: number;
}

export const NODE_WIDTH = 236;
const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 20;
const FOOTER_HEIGHT = 8;
export const MAX_ROWS = 14;

function multiplicityLabel(m: Multiplicity | null): string | null {
  return m;
}

function nodeFor(type: StructuredType, showProperties: boolean): GraphNode {
  const key = type.kind === "entity" ? new Set(type.key) : new Set<string>();
  const allRows: GraphRow[] = showProperties
    ? type.properties.map((p) => ({
        id: p.id,
        name: p.name,
        type: shortType(p.type),
        isKey: key.has(p.name),
        nullable: p.nullable,
      }))
    : [];
  // Keys always stay visible; the rest is cut at MAX_ROWS.
  const keys = allRows.filter((r) => r.isKey);
  const others = allRows.filter((r) => !r.isKey);
  const rows = [...keys, ...others.slice(0, Math.max(0, MAX_ROWS - keys.length))];
  const hiddenRows = allRows.length - rows.length;
  const height = HEADER_HEIGHT + rows.length * ROW_HEIGHT + (hiddenRows ? ROW_HEIGHT : 0) + FOOTER_HEIGHT;
  return {
    id: type.id,
    type,
    title: type.name,
    subtitle: type.base_type ? `: ${shortType(type.base_type)}` : null,
    rows,
    hiddenRows,
    kind: type.kind,
    abstract: type.abstract,
    width: NODE_WIDTH,
    height,
  };
}

export function buildGraph(index: ModelIndex, options: GraphOptions): Graph {
  const types: StructuredType[] = [...index.entityTypes, ...(options.showComplexTypes ? index.complexTypes : [])];
  const byName = new Map(types.map((t) => [t.qualified_name, t]));

  // Adjacency over the candidate types (navigation, inheritance, composition).
  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  };
  for (const t of types) {
    neighbours.set(t.qualified_name, neighbours.get(t.qualified_name) ?? new Set());
    for (const nav of t.navigation_properties) if (byName.has(nav.target_type)) link(t.qualified_name, nav.target_type);
    if (t.base_type && byName.has(t.base_type)) link(t.qualified_name, t.base_type);
    if (options.showComplexTypes) {
      for (const p of t.properties) {
        const { base } = stripCollection(p.type);
        if (byName.has(base)) link(t.qualified_name, base);
      }
    }
  }

  let chosen: StructuredType[];
  if (options.focusId) {
    const focus = types.find((t) => t.id === options.focusId);
    if (focus) {
      const keep = new Set<string>([focus.qualified_name, ...(neighbours.get(focus.qualified_name) ?? [])]);
      chosen = types.filter((t) => keep.has(t.qualified_name));
    } else {
      chosen = types;
    }
  } else {
    chosen = types;
  }
  if (chosen.length > options.maxNodes) {
    chosen = [...chosen]
      .sort((a, b) => (neighbours.get(b.qualified_name)?.size ?? 0) - (neighbours.get(a.qualified_name)?.size ?? 0))
      .slice(0, options.maxNodes);
  }
  const chosenNames = new Set(chosen.map((t) => t.qualified_name));

  const nodes = chosen.map((t) => nodeFor(t, options.showProperties));
  const edges: GraphEdge[] = [];
  const seenPairs = new Set<string>();
  for (const t of chosen) {
    for (const nav of t.navigation_properties) {
      const target = byName.get(nav.target_type);
      if (!target || !chosenNames.has(target.qualified_name)) continue;
      // A navigation and its partner are one relationship; draw it once.
      const partnerId = nav.partner ? `nav:${target.qualified_name}/${nav.partner}` : null;
      if (partnerId && seenPairs.has(partnerId)) continue;
      seenPairs.add(nav.id);
      const partner = partnerId ? target.navigation_properties.find((n) => n.name === nav.partner) : undefined;
      edges.push({
        id: `e:${nav.id}`,
        source: t.id,
        target: target.id,
        kind: "navigation",
        label: partner ? `${nav.name} / ${partner.name}` : nav.name,
        sourceLabel: multiplicityLabel(nav.source_multiplicity ?? partner?.multiplicity ?? null),
        targetLabel: multiplicityLabel(nav.multiplicity),
        selectId: nav.id,
        bidirectional: Boolean(partner),
      });
    }
    if (t.base_type && chosenNames.has(t.base_type)) {
      edges.push({
        id: `i:${t.id}`,
        source: t.id,
        target: byName.get(t.base_type)!.id,
        kind: "inheritance",
        label: null,
        sourceLabel: null,
        targetLabel: null,
        selectId: null,
        bidirectional: false,
      });
    }
    if (options.showComplexTypes) {
      for (const p of t.properties) {
        const { base, collection } = stripCollection(p.type);
        const complex = byName.get(base);
        if (!complex || complex.kind !== "complex" || !chosenNames.has(base)) continue;
        edges.push({
          id: `c:${p.id}`,
          source: t.id,
          target: complex.id,
          kind: "composition",
          label: p.name,
          sourceLabel: null,
          targetLabel: collection ? "*" : null,
          selectId: p.id,
          bidirectional: false,
        });
      }
    }
  }
  return { nodes, edges, omitted: types.length - chosen.length };
}
