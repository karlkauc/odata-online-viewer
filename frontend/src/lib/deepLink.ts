// Shareable links.
//
//   ?url=https://host/odata/        load this service on arrival
//   ?sample=northwind-v4            load a built-in sample
//   #/id/type%3ANS.Person           select this node (ids from backend/app/odata/model.py)
//   #/id/…?view=diagram             and open this view
//   #/id/set%3ANS.C%2FPeople?view=data&filter=…&top=5
//                                   open the data explorer on that set and run the query
//
// The hash never reaches the server, so selection is private to the browser;
// the query string does, which is fine for public service URLs (credentials
// are never put into a link). backend/app/odata/sample_pages.py writes the same format.

import type { ViewMode } from "../stores/appStore";
import type { QueryOptions } from "../types/model";

const PREFIX = "#/id/";
const VIEWS: ViewMode[] = ["details", "diagram", "source", "data"];
const MAX_TOP = 500;

/** The query options a link carries; the rest keep their defaults. */
export type HashQuery = Partial<Pick<QueryOptions, "filter" | "select" | "orderby" | "top" | "skip" | "expand" | "search">>;

const TEXT_KEYS = ["filter", "orderby", "expand", "search"] as const;

export interface HashState {
  id: string | null;
  view: ViewMode | null;
  query: HashQuery;
}

function readInt(value: string | null, min: number, max: number): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n >= min && n <= max ? n : undefined;
}

export function readHash(hash: string = window.location.hash): HashState {
  if (!hash.startsWith(PREFIX)) return { id: null, view: null, query: {} };
  const rest = hash.slice(PREFIX.length);
  const cut = rest.indexOf("?");
  const rawId = cut < 0 ? rest : rest.slice(0, cut);
  const params = new URLSearchParams(cut < 0 ? "" : rest.slice(cut + 1));
  let id: string | null = null;
  try {
    id = rawId ? decodeURIComponent(rawId) : null;
  } catch {
    id = null;
  }
  const view = params.get("view");
  const query: HashQuery = {};
  for (const key of TEXT_KEYS) {
    const value = params.get(key)?.trim();
    if (value) query[key] = value;
  }
  const select = params.get("select");
  if (select) query.select = select.split(",").map((s) => s.trim()).filter(Boolean);
  const top = readInt(params.get("top"), 1, MAX_TOP);
  if (top !== undefined) query.top = top;
  const skip = readInt(params.get("skip"), 0, Number.MAX_SAFE_INTEGER);
  if (skip !== undefined) query.skip = skip;
  return { id, view: VIEWS.includes(view as ViewMode) ? (view as ViewMode) : null, query };
}

/** The options worth putting into a link: everything that differs from a fresh query. */
export function linkQuery(options: QueryOptions, defaults: QueryOptions): HashQuery {
  const query: HashQuery = {};
  for (const key of TEXT_KEYS) if (options[key]) query[key] = options[key];
  if (options.select.length > 0) query.select = options.select;
  if (options.top !== defaults.top) query.top = options.top;
  if (options.skip !== defaults.skip) query.skip = options.skip;
  return query;
}

export function buildHash(id: string | null, view: ViewMode | null, query: HashQuery = {}): string {
  const params: string[] = view ? [`view=${view}`] : [];
  for (const key of TEXT_KEYS) {
    const value = query[key];
    if (value) params.push(`${key}=${encodeURIComponent(value)}`);
  }
  if (query.select?.length) params.push(`select=${encodeURIComponent(query.select.join(","))}`);
  if (query.top !== undefined) params.push(`top=${query.top}`);
  if (query.skip) params.push(`skip=${query.skip}`);
  if (!id && params.length === 0) return "";
  return `${PREFIX}${id ? encodeURIComponent(id) : ""}${params.length ? "?" + params.join("&") : ""}`;
}

export function writeHash(id: string | null, view: ViewMode | null, query: HashQuery = {}): void {
  replaceHash(buildHash(id, view, query));
}

export function replaceHash(next: string): void {
  if (next === window.location.hash || (next === "" && window.location.hash === "")) return;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
}

export interface ArrivalRequest {
  url: string | null;
  sample: string | null;
}

export function readArrival(search: string = window.location.search): ArrivalRequest {
  const params = new URLSearchParams(search);
  return { url: params.get("url"), sample: params.get("sample") };
}

/** Link to the current page that reloads the same public service. */
export function shareLink(serviceRoot: string | null, id: string | null, view: ViewMode | null, query: HashQuery = {}): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  const search = serviceRoot ? `?url=${encodeURIComponent(serviceRoot)}` : "";
  return `${base}${search}${buildHash(id, view, query)}`;
}
