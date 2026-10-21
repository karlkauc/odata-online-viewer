import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeMarkerType,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useApp } from "../../stores/appStore";
import { MD_QUERY, useMediaQuery } from "../../lib/useMediaQuery";
import { useDismiss } from "../../lib/useDismiss";
import { buildGraph, type Graph, type GraphEdge } from "./buildGraph";
import { EntityNode, type EntityNodeData } from "./EntityNode";
import { RelationEdge } from "./RelationEdge";
import { exportFlowAsPng, exportFlowAsSvg } from "./exportImage";
import { pingFeature } from "../../api/client";
import { FULL_FIT } from "./fitOptions";
import { layoutGraph, type Positioned } from "./layout";
import { Icon } from "../Icon";

const NODE_TYPES = { entity: EntityNode };
const EDGE_TYPES = { relation: RelationEdge };
const MAX_NODES = 150;

type FlowNode = Node<EntityNodeData, "entity">;

function edgeStyle(edge: GraphEdge, dark: boolean, highlighted: boolean) {
  const base = dark ? "#94a3b8" : "#64748b";
  const accent = dark ? "#60a5fa" : "#2563eb";
  const stroke = highlighted ? accent : base;
  if (edge.kind === "inheritance") {
    return {
      style: { stroke, strokeWidth: highlighted ? 2 : 1.5, strokeDasharray: "6 4" },
      markerEnd: { type: "arrowclosed", color: stroke, width: 18, height: 18 } as EdgeMarkerType,
    };
  }
  if (edge.kind === "composition") {
    return {
      style: { stroke, strokeWidth: highlighted ? 2 : 1.2, strokeDasharray: "2 3" },
      markerEnd: { type: "arrow", color: stroke, width: 14, height: 14 } as EdgeMarkerType,
    };
  }
  return {
    style: { stroke, strokeWidth: highlighted ? 2.2 : 1.4 },
    markerEnd: { type: "arrow", color: stroke, width: 16, height: 16 } as EdgeMarkerType,
  };
}

function toFlow(
  graph: Graph,
  layout: Positioned,
  selectedId: string | null,
  highlightedTypeId: string | null,
  highlightedRow: string | null,
  dark: boolean,
): { nodes: FlowNode[]; edges: Edge[] } {
  const neighbourIds = new Set<string>();
  if (highlightedTypeId) {
    neighbourIds.add(highlightedTypeId);
    for (const e of graph.edges) {
      if (e.source === highlightedTypeId) neighbourIds.add(e.target);
      if (e.target === highlightedTypeId) neighbourIds.add(e.source);
    }
  }
  const nodes: FlowNode[] = graph.nodes.map((n) => ({
    id: n.id,
    type: "entity",
    position: layout.positions.get(n.id) ?? { x: 0, y: 0 },
    width: n.width,
    height: n.height,
    draggable: true,
    selectable: true,
    data: {
      graphNode: n,
      selected: n.id === highlightedTypeId,
      dimmed: highlightedTypeId !== null && !neighbourIds.has(n.id),
      highlightedRow,
    },
  }));
  const centerX = (id: string) => {
    const node = graph.nodes.find((n) => n.id === id);
    return (layout.positions.get(id)?.x ?? 0) + (node?.width ?? 0) / 2;
  };
  const edges: Edge[] = graph.edges.map((e) => {
    // Leave on the side facing the target so edges do not loop around the box.
    const rightwards = centerX(e.target) >= centerX(e.source);
    const highlighted =
      highlightedTypeId !== null && (e.source === highlightedTypeId || e.target === highlightedTypeId || e.selectId === selectedId);
    const { style, markerEnd } = edgeStyle(e, dark, highlighted);
    const dimmed = highlightedTypeId !== null && !highlighted;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: rightwards ? "r-s" : "l-s",
      targetHandle: rightwards ? "l-t" : "r-t",
      type: "relation",
      label: e.label ?? undefined,
      style: { ...style, opacity: dimmed ? 0.25 : 1 },
      markerEnd,
      markerStart: e.bidirectional && e.kind === "navigation" ? markerEnd : undefined,
      data: { sourceLabel: e.sourceLabel, targetLabel: e.targetLabel, selectId: e.selectId, dimmed },
      interactionWidth: 16,
    };
  });
  return { nodes, edges };
}

function DiagramInner() {
  const index = useApp((s) => s.index);
  const model = useApp((s) => s.model);
  const selectedId = useApp((s) => s.selectedId);
  const setSelected = useApp((s) => s.setSelected);
  const setViewMode = useApp((s) => s.setViewMode);
  const options = useApp((s) => s.diagram);
  const setDiagram = useApp((s) => s.setDiagram);
  const compact = !useMediaQuery(MD_QUERY);
  const { fitView, getNodes } = useReactFlow();
  const [layout, setLayout] = useState<{ key: string; positioned: Positioned } | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useDismiss(menuRef, menuOpen, closeMenu);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // The type the selection belongs to (a property selects its owner).
  const selectedEntry = selectedId && index ? index.byId.get(selectedId) : undefined;
  const highlightedTypeId = selectedEntry
    ? selectedEntry.owner
      ? selectedEntry.owner.id
      : selectedEntry.kind === "entity" || selectedEntry.kind === "complex"
        ? selectedEntry.id
        : selectedEntry.kind === "set" || selectedEntry.kind === "singleton"
          ? (index!.typesByName.get((selectedEntry.node as { entity_type: string }).entity_type)?.id ?? null)
          : null
    : null;
  const highlightedRow = selectedEntry && (selectedEntry.kind === "prop" || selectedEntry.kind === "nav") ? selectedEntry.id : null;

  const graph = useMemo<Graph | null>(() => {
    if (!index) return null;
    return buildGraph(index, {
      showProperties: options.showProperties,
      showComplexTypes: options.showComplexTypes,
      focusId: options.focus ? highlightedTypeId : null,
      maxNodes: MAX_NODES,
    });
  }, [index, options.showProperties, options.showComplexTypes, options.focus, highlightedTypeId]);

  const layoutKey = useMemo(() => {
    if (!graph || !model) return "";
    return `${model.metadata_id}|${graph.nodes.map((n) => `${n.id}:${n.height}`).join(",")}|${graph.edges.map((e) => e.id).join(",")}`;
  }, [graph, model]);

  useEffect(() => {
    if (!graph || !layoutKey) return;
    let cancelled = false;
    setLayoutError(null);
    layoutGraph(graph)
      .then((positioned) => {
        if (!cancelled) setLayout({ key: layoutKey, positioned });
      })
      .catch((err) => {
        if (!cancelled) setLayoutError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [graph, layoutKey]);

  const ready = graph !== null && layout !== null && layout.key === layoutKey;
  const flow = useMemo(
    () => (ready ? toFlow(graph, layout.positioned, selectedId, highlightedTypeId, highlightedRow, dark) : { nodes: [], edges: [] }),
    [ready, graph, layout, selectedId, highlightedTypeId, highlightedRow, dark],
  );

  // Fit once per layout; when a selection exists, centre on it instead.
  const fittedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || fittedKey.current === layoutKey) return;
    fittedKey.current = layoutKey;
    requestAnimationFrame(() => {
      if (highlightedTypeId && flow.nodes.some((n) => n.id === highlightedTypeId)) {
        void fitView({ nodes: [{ id: highlightedTypeId }], padding: 0.6, maxZoom: 1, duration: 250 });
      } else {
        void fitView(FULL_FIT);
      }
    });
  }, [ready, layoutKey, fitView, highlightedTypeId, flow.nodes]);

  // Selection made elsewhere (tree, search): bring the node into view.
  const lastCentered = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !highlightedTypeId || lastCentered.current === highlightedTypeId) return;
    lastCentered.current = highlightedTypeId;
    if (flow.nodes.some((n) => n.id === highlightedTypeId)) {
      void fitView({ nodes: [{ id: highlightedTypeId }], padding: 0.8, maxZoom: 1, minZoom: 0.5, duration: 300 });
    }
  }, [ready, highlightedTypeId, fitView, flow.nodes]);

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      setSelected(node.id);
    },
    [setSelected],
  );

  const onExport = useCallback(
    async (format: "png" | "svg") => {
      const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
      if (!viewport) return;
      const name = (model?.service_root ?? model?.filename ?? "odata").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);
      try {
        if (format === "png") await exportFlowAsPng(viewport, getNodes(), { filename: `${name}-er-diagram.png` });
        else await exportFlowAsSvg(viewport, getNodes(), { filename: `${name}-er-diagram.svg` });
        pingFeature(format === "svg" ? "diagram_svg" : "diagram_png");
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
      }
    },
    [getNodes, model],
  );

  if (!index || !graph) return null;

  const Toggle = ({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title: string }) => (
    <label className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap px-2 py-1 touch:py-2 cursor-pointer" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );

  const toolbar = (
    <>
      <Toggle label="Properties" checked={options.showProperties} onChange={(v) => setDiagram({ showProperties: v })} title="Show property rows inside the entity boxes" />
      <Toggle label="Complex types" checked={options.showComplexTypes} onChange={(v) => setDiagram({ showComplexTypes: v })} title="Include complex types and their usage" />
      <Toggle label="Focus" checked={options.focus} onChange={(v) => setDiagram({ focus: v })} title="Only the selected type and its neighbours" />
      <Toggle label="Minimap" checked={options.minimap} onChange={(v) => setDiagram({ minimap: v })} title="Show the minimap" />
      <button type="button" className="btn text-xs py-1" onClick={() => void fitView(FULL_FIT)}>
        Fit
      </button>
      <button type="button" className="btn text-xs py-1" onClick={() => void onExport("png")}>
        PNG
      </button>
      <button type="button" className="btn text-xs py-1" onClick={() => void onExport("svg")}>
        SVG
      </button>
    </>
  );

  return (
    <div className="relative h-full w-full">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 flex-wrap justify-end">
        {compact ? (
          <div ref={menuRef} className="relative">
            <button type="button" className="btn px-2.5" aria-label="Diagram options" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
              <Icon name="settings" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-20 flex flex-col items-stretch gap-1 p-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
                {toolbar}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 backdrop-blur px-1 py-0.5">
            {toolbar}
          </div>
        )}
      </div>

      {(graph.omitted > 0 || (options.focus && !highlightedTypeId)) && (
        <div className="absolute top-2 left-2 z-10 max-w-[60%] rounded-md bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 text-xs px-2 py-1">
          {options.focus && !highlightedTypeId
            ? "Focus mode: select an entity type (tree, search or a box) to see it with its neighbours."
            : `${graph.omitted} types hidden — ${options.focus ? "focus mode" : `showing the ${MAX_NODES} most connected`}.`}
        </div>
      )}

      {layoutError && (
        <p className="absolute inset-x-4 top-14 z-10 text-sm text-red-700 dark:text-red-400" role="alert">
          Layout failed: {layoutError}
        </p>
      )}

      {ready && graph.nodes.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          {index.entityTypes.length === 0 ? "This service declares no entity types." : "Nothing to show."}
        </p>
      )}

      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodeClick={onNodeClick}
        onEdgeClick={(_, edge) => {
          const selectId = (edge.data as { selectId?: string | null } | undefined)?.selectId;
          if (selectId) setSelected(selectId);
        }}
        onPaneClick={() => undefined}
        onNodeDoubleClick={(_, node) => {
          setSelected(node.id);
          setViewMode("details");
        }}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        className={clsx(!ready && "opacity-0")}
      >
        <Background gap={16} color={dark ? "#1e293b" : "#e2e8f0"} />
        <Controls showInteractive={false} position="bottom-left" />
        {options.minimap && !compact && <MiniMap pannable zoomable nodeStrokeWidth={2} className="!bg-white dark:!bg-slate-900" />}
      </ReactFlow>

      {!ready && !layoutError && graph.nodes.length > 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 pointer-events-none">
          Laying out {graph.nodes.length} types…
        </p>
      )}
    </div>
  );
}

export function DiagramView() {
  return (
    <ReactFlowProvider>
      <DiagramInner />
    </ReactFlowProvider>
  );
}
