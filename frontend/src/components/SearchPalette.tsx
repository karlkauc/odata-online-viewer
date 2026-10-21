import { useEffect, useMemo, useRef, useState } from "react";
import { pingFeature } from "../api/client";
import { EVENT_OPEN_SEARCH } from "../lib/links";
import type { IndexEntry } from "../lib/modelIndex";
import { useApp } from "../stores/appStore";
import { KindBadge } from "./KindBadge";

const MAX_RESULTS = 60;
// Types and sets first, members last, when scores tie.
const KIND_RANK: Record<string, number> = {
  set: 0,
  singleton: 0,
  entity: 1,
  complex: 2,
  enum: 2,
  typedef: 2,
  op: 3,
  import: 3,
  container: 4,
  schema: 4,
  prop: 5,
  nav: 5,
};

export function SearchPalette() {
  const index = useApp((s) => s.index);
  const setSelected = useApp((s) => s.setSelected);
  const setViewMode = useApp((s) => s.setViewMode);
  const viewMode = useApp((s) => s.viewMode);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handler = () => {
      setOpen(true);
      pingFeature("search_open", { once: true });
      setQuery("");
      setCursor(0);
    };
    window.addEventListener(EVENT_OPEN_SEARCH, handler);
    return () => window.removeEventListener(EVENT_OPEN_SEARCH, handler);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const entries = useMemo(() => index?.entries.filter((e) => e.kind !== "schema") ?? [], [index]);

  const results = useMemo<IndexEntry[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries.filter((e) => e.kind === "set" || e.kind === "entity").slice(0, MAX_RESULTS);
    const scored: { entry: IndexEntry; score: number }[] = [];
    for (const entry of entries) {
      const label = entry.label.toLowerCase();
      let score = 0;
      if (label === needle) score = 5;
      else if (label.startsWith(needle)) score = 4;
      else if (label.includes(needle)) score = 3;
      else if ((entry.qualifiedName ?? "").toLowerCase().includes(needle)) score = 2;
      else if (entry.searchText.includes(needle)) score = 1;
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        (KIND_RANK[a.entry.kind] ?? 9) - (KIND_RANK[b.entry.kind] ?? 9) ||
        a.entry.label.localeCompare(b.entry.label),
    );
    return scored.slice(0, MAX_RESULTS).map((x) => x.entry);
  }, [query, entries]);

  useEffect(() => {
    if (cursor >= results.length) setCursor(Math.max(0, results.length - 1));
  }, [results, cursor]);

  if (!open) return null;

  const commit = (entry: IndexEntry) => {
    setSelected(entry.id);
    if (viewMode === "data" || viewMode === "source") setViewMode("details");
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-start justify-center px-4 pt-4 md:pt-[10vh] z-50"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800">
        <input
          ref={inputRef}
          className="w-full px-4 py-3 bg-transparent border-b border-slate-200 dark:border-slate-800 outline-none"
          placeholder="Search entity sets, types, properties, navigations, labels…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            else if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((c) => Math.min(c + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const hit = results[cursor];
              if (hit) commit(hit);
            }
          }}
          aria-label="Search the model"
        />
        <ul className="max-h-[60dvh] md:max-h-[50vh] overflow-auto py-1" role="listbox">
          {results.length === 0 && <li className="px-4 py-2 text-sm text-slate-500">No matches.</li>}
          {results.map((entry, i) => (
            <li
              key={entry.id}
              role="option"
              aria-selected={i === cursor}
              className={"px-4 py-2 touch:py-3 text-sm cursor-pointer " + (i === cursor ? "bg-blue-50 dark:bg-blue-900/30" : "")}
              onMouseEnter={() => setCursor(i)}
              onClick={() => commit(entry)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <KindBadge kind={entry.kind} />
                <span className="font-mono">{entry.label}</span>
                <span className="text-xs text-slate-500 truncate">
                  {entry.owner ? `${entry.owner.name} · ` : ""}
                  {entry.qualifiedName && entry.qualifiedName !== entry.label ? entry.qualifiedName : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
