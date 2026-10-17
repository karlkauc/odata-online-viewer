// Shareable links.
//
//   ?url=https://host/odata/        load this service on arrival
//   ?sample=northwind-v4            load a built-in sample
//   #/id/type%3ANS.Person           select this node (ids from backend/app/odata/model.py)
//   #/id/…?view=diagram             and open this view
//
// The hash never reaches the server, so selection is private to the browser;
// the query string does, which is fine for public service URLs (credentials
// are never put into a link).

import type { ViewMode } from "../stores/appStore";

const PREFIX = "#/id/";
const VIEWS: ViewMode[] = ["details", "diagram", "source", "data"];

export interface HashState {
  id: string | null;
  view: ViewMode | null;
}

export function readHash(hash: string = window.location.hash): HashState {
  if (!hash.startsWith(PREFIX)) return { id: null, view: null };
  const rest = hash.slice(PREFIX.length);
  const [rawId, query = ""] = rest.split("?", 2);
  let id: string | null = null;
  try {
    id = rawId ? decodeURIComponent(rawId) : null;
  } catch {
    id = null;
  }
  const view = new URLSearchParams(query).get("view");
  return { id, view: VIEWS.includes(view as ViewMode) ? (view as ViewMode) : null };
}

export function buildHash(id: string | null, view: ViewMode | null): string {
  if (!id && !view) return "";
  const query = view ? `?view=${view}` : "";
  return `${PREFIX}${id ? encodeURIComponent(id) : ""}${query}`;
}

export function writeHash(id: string | null, view: ViewMode | null): void {
  const next = buildHash(id, view);
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
export function shareLink(serviceRoot: string | null, id: string | null, view: ViewMode | null): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  const query = serviceRoot ? `?url=${encodeURIComponent(serviceRoot)}` : "";
  return `${base}${query}${buildHash(id, view)}`;
}
