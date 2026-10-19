import type { Cell, EntityType, QueryResponse, StructuredType } from "../types/model";
import { baseChain, effectiveMembers, stripCollection, type ModelIndex } from "./modelIndex";

/** What a resource path addresses; `type` is null for primitives and unknown members. */
export interface PathTarget {
  type: StructuredType | null;
  collection: boolean;
}

/** Strip leading and trailing `/`. Not a regex: `/\/+$/` is quadratic on a long run of
 *  slashes, and paths can come from a service's `@link` values. */
function trimSlashes(path: string): string {
  let start = 0;
  let end = path.length;
  while (start < end && path[start] === "/") start += 1;
  while (end > start && path[end - 1] === "/") end -= 1;
  return path.slice(start, end);
}

/** Split a resource path at `/` outside key predicates (`P('a/b')/Nav`). Mirrors the backend. */
export function pathSegments(path: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const ch of trimSlashes(path)) {
    if (ch === "'") quoted = !quoted;
    else if (!quoted && ch === "(") depth += 1;
    else if (!quoted && ch === ")") depth -= 1;
    else if (ch === "/" && depth === 0 && !quoted) {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.filter(Boolean);
}

function structured(index: ModelIndex, name: string): StructuredType | null {
  const type = index.typesByName.get(name);
  return type && (type.kind === "entity" || type.kind === "complex") ? type : null;
}

/** Walk `Set(key)/Nav/Prop` through the model to the addressed type. */
export function resolvePath(index: ModelIndex, path: string): PathTarget {
  const [head, ...rest] = pathSegments(path.split("?")[0]);
  if (!head) return { type: null, collection: true };
  const name = head.split("(")[0];
  let type: StructuredType | null = null;
  let collection = true;
  const set = index.entitySets.find((s) => s.set.name === name);
  if (set) {
    type = structured(index, set.set.entity_type);
    collection = !head.includes("(");
  } else {
    const singleton = index.entitySets.flatMap((s) => s.container.singletons).find((s) => s.name === name);
    if (singleton) {
      type = structured(index, singleton.entity_type);
      collection = false;
    }
  }
  for (const segment of rest) {
    if (!type) return { type: null, collection };
    const member = segment.split("(")[0];
    const { properties, navigations } = effectiveMembers(index, type);
    const prop = properties.find((p) => p.name === member);
    const nav = navigations.find((n) => n.name === member);
    if (prop) {
      const { base, collection: many } = stripCollection(prop.type);
      type = structured(index, base);
      collection = many;
    } else if (nav) {
      type = structured(index, nav.target_type);
      collection = nav.is_collection;
    } else {
      return { type: null, collection: true };
    }
    if (segment.includes("(")) collection = false;
  }
  return { type, collection };
}

function effectiveKey(index: ModelIndex, type: EntityType): string[] {
  if (type.key.length) return type.key;
  const base = baseChain(index, type).find((t): t is EntityType => t.kind === "entity" && t.key.length > 0);
  return base?.key ?? [];
}

const NUMERIC = new Set(["Edm.Byte", "Edm.SByte", "Edm.Int16", "Edm.Int32", "Edm.Int64", "Edm.Decimal", "Edm.Double", "Edm.Single"]);

/** URL literal of a key value, or null when it cannot be written (binary, structured, missing). */
export function keyLiteral(value: Cell | undefined, type: string, v4: boolean): string | null {
  if (value === null || value === undefined || typeof value === "object") return null;
  const text = String(value);
  if (NUMERIC.has(type) || typeof value === "number") {
    if (!v4 && type === "Edm.Int64") return `${text}L`;
    if (!v4 && type === "Edm.Decimal") return `${text}M`;
    return text;
  }
  if (typeof value === "boolean" || type === "Edm.Boolean") return text;
  switch (type) {
    case "Edm.Guid":
      return v4 ? text : `guid'${text}'`;
    case "Edm.DateTime":
      // The backend turned /Date(ms)/ into ISO with a Z; V2 datetime literals carry no zone.
      return `datetime'${text.replace(/Z$/, "")}'`;
    case "Edm.DateTimeOffset":
      return v4 ? text : `datetimeoffset'${text}'`;
    case "Edm.Time":
      return `time'${text}'`;
    case "Edm.Date":
    case "Edm.TimeOfDay":
    case "Edm.Duration":
      return v4 ? text : `'${text}'`;
    case "Edm.Binary":
    case "Edm.Stream":
      return null;
  }
  return `'${text.replace(/'/g, "''")}'`;
}

/** `(1)`, `('a''b')` or `(A=1,B='x')` for a row; null when a key value is missing. */
export function keyPredicate(index: ModelIndex, type: EntityType, row: Record<string, Cell>, v4: boolean): string | null {
  const keys = effectiveKey(index, type);
  if (keys.length === 0) return null;
  const props = effectiveMembers(index, type).properties;
  const literals: string[] = [];
  for (const key of keys) {
    const literal = keyLiteral(row[key], props.find((p) => p.name === key)?.type ?? "Edm.String", v4);
    if (literal === null) return null;
    literals.push(keys.length === 1 ? literal : `${key}=${literal}`);
  }
  return `(${literals.join(",")})`;
}

/**
 * The resource path that addresses `row[column]` on the service, e.g.
 * `Orders` + row Id 1 + `Tags` → `Orders(1)/Tags`, or the path of a V2 deferred link.
 * Null when the row cannot be addressed (no key, complex or unknown level).
 */
export function drillPath(
  index: ModelIndex,
  serviceRoot: string | null,
  v4: boolean,
  path: string,
  row: Record<string, Cell>,
  column: string,
): string | null {
  const cell = row[column];
  if (cell && typeof cell === "object" && !Array.isArray(cell) && typeof cell["@link"] === "string") {
    const link = cell["@link"];
    const root = serviceRoot?.split("?")[0].replace(/\/?$/, "/");
    if (!root || !link.startsWith(root)) return null;
    try {
      return decodeURIComponent(link.slice(root.length).split("?")[0]);
    } catch {
      return null;
    }
  }
  const target = resolvePath(index, path);
  if (!target.type || target.type.kind !== "entity") return null;
  const { properties, navigations } = effectiveMembers(index, target.type);
  if (!properties.some((p) => p.name === column) && !navigations.some((n) => n.name === column)) return null;
  const key = target.collection ? keyPredicate(index, target.type, row, v4) : "";
  if (key === null) return null;
  return `${path}${key}/${column}`;
}

/** A table built from a cell's inline value, for levels the service cannot address. */
export function localResult(value: Cell): QueryResponse {
  const items = Array.isArray(value) ? value : [value];
  const rows = items.map((item): Record<string, Cell> =>
    item !== null && typeof item === "object" && !Array.isArray(item) ? item : { value: item },
  );
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  return {
    request_url: "",
    status_code: 200,
    columns,
    rows,
    count: rows.length,
    next_link: null,
    duration_ms: 0,
    notices: ["Shown from the parent row; the service was not queried."],
    paged: false,
  };
}
