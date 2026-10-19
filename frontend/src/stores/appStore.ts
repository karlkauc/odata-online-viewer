import { create } from "zustand";
import { buildIndex, type ModelIndex } from "../lib/modelIndex";
import type { Auth, QueryOptions, QueryResponse, ServiceModel } from "../types/model";

/** The content pane. On phones the tree is a pane of its own (see MobileNav). */
export type ViewMode = "details" | "diagram" | "source" | "data";

/** How the current model was loaded, so an expired cache entry can be rebuilt
 * and the Files summary can say where it came from. */
export type LoadInfo =
  | { kind: "url"; url: string }
  | { kind: "sample"; sampleId: string; name: string }
  | { kind: "text"; filename: string }
  | { kind: "upload"; filename: string };

export interface DiagramOptions {
  showProperties: boolean;
  showComplexTypes: boolean;
  /** Only the selected type and its neighbours. Forced on for very large models. */
  focus: boolean;
  minimap: boolean;
}

export const DEFAULT_QUERY: QueryOptions = {
  top: 50,
  skip: 0,
  filter: null,
  select: [],
  orderby: null,
  expand: null,
  search: null,
  count: true,
  extra: null,
};

export interface DataState {
  entitySet: string | null;
  options: QueryOptions;
  result: QueryResponse | null;
  loading: boolean;
  error: string | null;
  /** Previous pages' skip values, for "Previous". */
  pageStack: number[];
  rawView: boolean;
  /** The result was taken from a parent row's cell, not queried (no key to address it by). */
  local: boolean;
  /** Levels left by drilling into a cell, outermost first; Back restores the last one. */
  trail: DrillLevel[];
}

export type DrillLevel = Pick<DataState, "entitySet" | "options" | "result" | "error" | "pageStack" | "rawView" | "local">;

interface AppState {
  model: ServiceModel | null;
  index: ModelIndex | null;
  loadInfo: LoadInfo | null;
  /** Credentials for the current service. Memory only, never persisted. */
  auth: Auth | null;

  selectedId: string | null;
  expandedIds: Set<string>;
  viewMode: ViewMode;
  diagram: DiagramOptions;
  data: DataState;
  /** Set by "View source" to jump to a line even when the selection stays. */
  sourceLine: number | null;

  setModel: (model: ServiceModel, loadInfo: LoadInfo) => void;
  clearModel: () => void;
  setAuth: (auth: Auth | null) => void;
  setSelected: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  expandIds: (ids: string[]) => void;
  collapseAll: () => void;
  setViewMode: (mode: ViewMode) => void;
  setDiagram: (patch: Partial<DiagramOptions>) => void;
  setData: (patch: Partial<DataState>) => void;
  openData: (entitySet: string) => void;
  jumpToSource: (line: number | null) => void;
}

/** Expand the schema, its container and the entity-set group so the first
 * screen shows something useful. */
function initialExpanded(index: ModelIndex, model: ServiceModel): Set<string> {
  const ids = new Set<string>();
  for (const schema of model.schemas) {
    ids.add(schema.id);
    for (const container of schema.containers) {
      ids.add(container.id);
      ids.add(`group:${container.id}/entity_sets`);
    }
    if (model.stats.entity_type_count <= 40) ids.add(`group:${schema.id}/entity_types`);
  }
  void index;
  return ids;
}

export const useApp = create<AppState>((set, get) => ({
  model: null,
  index: null,
  loadInfo: null,
  auth: null,

  selectedId: null,
  expandedIds: new Set(),
  viewMode: "details",
  diagram: { showProperties: true, showComplexTypes: false, focus: false, minimap: false },
  data: {
    entitySet: null,
    options: DEFAULT_QUERY,
    result: null,
    loading: false,
    error: null,
    pageStack: [],
    rawView: false,
    local: false,
    trail: [],
  },
  sourceLine: null,

  setModel: (model, loadInfo) => {
    const index = buildIndex(model);
    const firstSet = index.entitySets[0]?.set.name ?? null;
    set({
      model,
      index,
      loadInfo,
      selectedId: null,
      expandedIds: initialExpanded(index, model),
      diagram: {
        ...get().diagram,
        focus: model.stats.entity_type_count > 120,
      },
      data: {
        entitySet: firstSet,
        options: DEFAULT_QUERY,
        result: null,
        loading: false,
        error: null,
        pageStack: [],
        rawView: false,
        local: false,
        trail: [],
      },
      sourceLine: null,
    });
  },

  clearModel: () =>
    set({
      model: null,
      index: null,
      loadInfo: null,
      selectedId: null,
      expandedIds: new Set(),
      viewMode: "details",
      sourceLine: null,
    }),

  setAuth: (auth) => set({ auth }),

  setSelected: (id) => {
    if (!id) {
      set({ selectedId: null, sourceLine: null });
      return;
    }
    // Reveal the node in the tree by expanding its ancestor chain.
    const entry = get().index?.byId.get(id);
    const next = new Set(get().expandedIds);
    if (entry) for (const ancestor of entry.path) next.add(ancestor);
    set({ selectedId: id, expandedIds: next, sourceLine: null });
  },

  toggleExpanded: (id) => {
    const next = new Set(get().expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ expandedIds: next });
  },

  expandIds: (ids) => {
    const next = new Set(get().expandedIds);
    for (const id of ids) next.add(id);
    set({ expandedIds: next });
  },

  collapseAll: () => set({ expandedIds: new Set() }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setDiagram: (patch) => set({ diagram: { ...get().diagram, ...patch } }),

  setData: (patch) => set({ data: { ...get().data, ...patch } }),

  openData: (entitySet) =>
    set({
      viewMode: "data",
      data: {
        ...get().data,
        entitySet,
        options: { ...DEFAULT_QUERY },
        result: get().data.entitySet === entitySet ? get().data.result : null,
        error: null,
        pageStack: [],
        local: false,
        trail: [],
      },
    }),

  jumpToSource: (line) => set({ viewMode: "source", sourceLine: line }),
}));
