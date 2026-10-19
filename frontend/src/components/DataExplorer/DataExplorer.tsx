import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ApiError, exportEntitySet, queryEntitySet } from "../../api/client";
import { drillPath, localResult, resolvePath } from "../../lib/drillPath";
import { effectiveMembers, shortType } from "../../lib/modelIndex";
import { useCopy } from "../../lib/useCopy";
import { useDismiss } from "../../lib/useDismiss";
import { DEFAULT_QUERY, useApp, type DrillLevel } from "../../stores/appStore";
import type { Auth, Cell, QueryOptions } from "../../types/model";
import { KindBadge } from "../KindBadge";
import { Icon, KeyIcon } from "../Icon";

const INPUT =
  "w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono";

const DRILL = "text-accent hover:underline text-left";

function CellView({ value, onOpen }: { value: Cell; onOpen?: () => void }) {
  if (value === null || value === undefined) return <span className="text-slate-400 italic">null</span>;
  if (typeof value === "boolean") return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>;
  if (typeof value === "number") return <span className="tabular-nums text-blue-800 dark:text-blue-300">{String(value)}</span>;
  if (typeof value === "string") {
    if (value.length > 300) return <span title={value}>{value.slice(0, 300)}…</span>;
    return <>{value}</>;
  }
  if (Array.isArray(value)) {
    const label = `[${value.length} item${value.length === 1 ? "" : "s"}]`;
    const title = JSON.stringify(value, null, 2);
    return onOpen && value.length > 0 ? (
      <button type="button" className={DRILL} title={title} onClick={onOpen}>
        {label}
      </button>
    ) : (
      <span className="text-slate-500" title={title}>
        {label}
      </span>
    );
  }
  if ("@link" in value && typeof value["@link"] === "string") {
    return onOpen ? (
      <button type="button" className={clsx(DRILL, "font-mono text-[11px]")} onClick={onOpen}>
        → {value["@link"]}
      </button>
    ) : (
      <span className="text-slate-500 font-mono text-[11px]">→ {value["@link"]}</span>
    );
  }
  const text = JSON.stringify(value);
  const shown = text.length > 120 ? text.slice(0, 120) + "…" : text;
  return onOpen ? (
    <button type="button" className={clsx(DRILL, "font-mono text-[11px]")} title={JSON.stringify(value, null, 2)} onClick={onOpen}>
      {shown}
    </button>
  ) : (
    <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300" title={JSON.stringify(value, null, 2)}>
      {shown}
    </span>
  );
}

function SelectPicker({ fields, selected, onChange }: { fields: { name: string; type: string; isKey: boolean }[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(ref, open, useCallback(() => setOpen(false), []));
  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);
  return (
    <div ref={ref} className="relative">
      <button type="button" className={clsx(INPUT, "text-left truncate")} onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        {selected.length === 0 ? <span className="text-slate-400">all properties</span> : selected.join(", ")}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-72 overflow-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-1 text-xs">
          <div className="flex gap-2 px-2 py-1 border-b border-slate-100 dark:border-slate-700 mb-1">
            <button type="button" className="text-accent hover:underline" onClick={() => onChange([])}>
              all
            </button>
            <button type="button" className="text-accent hover:underline" onClick={() => onChange(fields.filter((f) => f.isKey).map((f) => f.name))}>
              keys only
            </button>
          </div>
          {fields.map((f) => (
            <label key={f.name} className="flex items-center gap-2 px-2 py-1 touch:py-2 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer font-mono">
              <input type="checkbox" checked={selected.includes(f.name)} onChange={() => toggle(f.name)} />
              <span className={clsx("truncate", f.isKey && "font-semibold")}>{f.name}</span>
              <span className="ml-auto text-slate-500">{f.type}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportMenu({ rows, all, busy, onExport }: { rows: number; all: boolean; busy: boolean; onExport: (scope: "page" | "all") => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(ref, open, useCallback(() => setOpen(false), []));
  const pick = (scope: "page" | "all") => {
    setOpen(false);
    onExport(scope);
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn text-xs py-0.5" disabled={busy} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {busy ? (
          "Exporting…"
        ) : (
          <>
            <Icon name="download" size={14} /> Excel <Icon name="chevronDown" size={12} />
          </>
        )}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-1 text-xs">
          <button type="button" role="menuitem" className="block w-full text-left px-2 py-1.5 touch:py-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700" onClick={() => pick("page")}>
            This page <span className="text-slate-500">({rows.toLocaleString()} row{rows === 1 ? "" : "s"})</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full text-left px-2 py-1.5 touch:py-2 rounded hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:hover:bg-transparent"
            disabled={!all}
            title={all ? "Pages through the service with the current $filter, $orderby, $select and $expand" : "Drill-down values have no query to repeat"}
            onClick={() => pick("all")}
          >
            All matching rows <span className="text-slate-500">(up to 50,000)</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function DataExplorer() {
  const model = useApp((s) => s.model);
  const index = useApp((s) => s.index);
  const auth = useApp((s) => s.auth);
  const setAuth = useApp((s) => s.setAuth);
  const data = useApp((s) => s.data);
  const setData = useApp((s) => s.setData);
  const setSelected = useApp((s) => s.setSelected);
  const setViewMode = useApp((s) => s.setViewMode);
  const { copied, copy } = useCopy();
  const [draft, setDraft] = useState<QueryOptions>(data.options);
  const [needAuth, setNeedAuth] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ text: string; error: boolean } | null>(null);
  const [credentials, setCredentials] = useState<Auth>({ username: auth?.username ?? "", password: auth?.password ?? "" });

  useEffect(() => setDraft(data.options), [data.options, data.entitySet]);
  useEffect(() => setExportNote(null), [data.result]);

  const v4 = model?.odata_version.startsWith("4") ?? true;
  const sets = index?.entitySets ?? [];
  // While drilled into a cell, `data.entitySet` is a resource path such as `Orders(1)/Tags`.
  const baseSet = data.trail[0]?.entitySet ?? data.entitySet;
  const current = sets.find((s) => s.set.name === baseSet) ?? null;
  const target = useMemo(() => (index && data.entitySet && !data.local ? resolvePath(index, data.entitySet) : null), [index, data.entitySet, data.local]);
  const entityType = target?.type ?? undefined;
  const fields = useMemo(() => {
    if (!index || !entityType) return [];
    const key = new Set(entityType.kind === "entity" ? entityType.key : []);
    return effectiveMembers(index, entityType).properties.map((p) => ({ name: p.name, type: shortType(p.type), isKey: key.has(p.name) }));
  }, [index, entityType]);

  const run = useCallback(
    async (options: QueryOptions, nextLink: string | null = null, pageStack: number[] = data.pageStack, entitySet = data.entitySet) => {
      if (!model || !entitySet) return;
      setData({ loading: true, error: null, options, pageStack });
      try {
        const result = await queryEntitySet(model.metadata_id, entitySet, options, auth, nextLink);
        setData({ result, loading: false, error: null });
        setNeedAuth(false);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err);
        setData({ loading: false, error: message });
        if (/HTTP 401|requires authentication|user name or password/i.test(message)) setNeedAuth(true);
      }
    },
    [model, data.entitySet, data.pageStack, auth, setData],
  );

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (data.local) return;
    void run({ ...draft, skip: 0 }, null, []);
  };

  const snapshot = (): DrillLevel => ({
    entitySet: data.entitySet,
    options: data.options,
    result: data.result,
    error: data.error,
    pageStack: data.pageStack,
    rawView: data.rawView,
    local: data.local,
  });

  const openCell = (row: Record<string, Cell>, column: string) => {
    if (!model || !index || !data.entitySet) return;
    const trail = [...data.trail, snapshot()];
    const path = data.local ? null : drillPath(index, model.service_root, v4, data.entitySet, row, column);
    if (path) {
      const options = { ...DEFAULT_QUERY };
      setData({ trail, entitySet: path, result: null, rawView: false, local: false });
      void run(options, null, [], path);
    } else {
      setData({
        trail,
        entitySet: `${data.entitySet}/${column}`,
        options: { ...DEFAULT_QUERY },
        result: localResult(row[column] ?? null),
        error: null,
        pageStack: [],
        rawView: false,
        local: true,
      });
    }
  };

  /** Return to `trail[depth]`, dropping it and every level after it. */
  const goBack = (depth = data.trail.length - 1) => {
    const level = data.trail[depth];
    if (!level || data.loading) return;
    setData({ ...level, trail: data.trail.slice(0, depth), loading: false });
  };

  const drillable = (value: Cell | undefined) => value !== null && typeof value === "object";

  const exportRows = async (scope: "page" | "all") => {
    if (!model || !data.entitySet || !data.result) return;
    setExporting(true);
    setExportNote(null);
    try {
      const table = scope === "page" ? { columns: data.result.columns, rows: data.result.rows } : undefined;
      const done = await exportEntitySet(model.metadata_id, data.entitySet, data.options, auth, table);
      if (done.truncated) setExportNote({ text: `The export stopped at ${done.rows.toLocaleString()} rows — narrow the $filter to get the rest (see the "Query" sheet).`, error: false });
    } catch (err) {
      setExportNote({ text: `Excel export failed: ${err instanceof ApiError ? err.message : String(err)}`, error: true });
    } finally {
      setExporting(false);
    }
  };

  const nextPage = () => {
    if (!data.result) return;
    const stack = [...data.pageStack, data.options.skip];
    if (data.result.next_link) void run(data.options, data.result.next_link, stack);
    else void run({ ...data.options, skip: data.options.skip + data.options.top }, null, stack);
  };

  const previousPage = () => {
    const stack = [...data.pageStack];
    const skip = stack.pop() ?? 0;
    void run({ ...data.options, skip }, null, stack);
  };

  if (!model || !index) return null;

  if (!model.service_root) {
    return (
      <div className="p-6 text-sm text-slate-600 dark:text-slate-400 max-w-xl">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">Data explorer</h2>
        <p>
          This metadata was {model.source === "upload" ? "uploaded" : model.source === "text" ? "pasted" : "loaded from a snapshot"}, so there is no
          service to query. Load the service by URL (the <em>Service URL</em> tab above) to browse its entity sets.
        </p>
      </div>
    );
  }

  if (sets.length === 0) {
    return <p className="p-6 text-sm text-slate-500">This service exposes no entity sets.</p>;
  }

  const result = data.result;
  // An unpaged answer (Orders(1)/Tags) is complete and ignores $skip.
  const unpaged = result?.paged === false;
  const offset = unpaged ? 0 : data.options.skip;
  const pageFrom = offset + 1;
  const pageTo = offset + (result?.rows.length ?? 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <form onSubmit={submit} className="border-b border-slate-200 dark:border-slate-800 p-3 space-y-2 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto] gap-2 items-end">
          <label className="block">
            <span className="text-slate-500">Entity set</span>
            <select
              className={clsx(INPUT, "mt-0.5")}
              value={baseSet ?? ""}
              onChange={(e) => {
                setData({ entitySet: e.target.value, result: null, error: null, pageStack: [], options: { ...DEFAULT_QUERY }, trail: [], local: false });
              }}
            >
              {sets.map(({ set, container }) => (
                <option key={set.id} value={set.name}>
                  {set.name} — {shortType(set.entity_type)}
                  {sets.some((o) => o.set.name === set.name && o.container !== container) ? ` (${container.name})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-500">$select</span>
            <div className="mt-0.5">
              <SelectPicker fields={fields} selected={draft.select} onChange={(select) => setDraft({ ...draft, select })} />
            </div>
          </label>
          <div className="flex gap-1.5">
            <button type="submit" className="btn btn-primary" disabled={data.loading || data.local}>
              {data.loading ? "Running…" : "▶ Run"}
            </button>
            {current && (
              <button type="button" className="btn" title="Show the entity set in the details pane" onClick={() => { setSelected(current.set.id); setViewMode("details"); }}>
                <KindBadge kind="set" />
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_5rem_5rem_auto] gap-2 items-end">
          <label className="block col-span-2 md:col-span-1">
            <span className="text-slate-500">$filter</span>
            <input
              className={clsx(INPUT, "mt-0.5")}
              placeholder={v4 ? "e.g. contains(Name,'a') and Price gt 10" : "e.g. substringof('a', Name) eq true and Price gt 10"}
              value={draft.filter ?? ""}
              onChange={(e) => setDraft({ ...draft, filter: e.target.value || null })}
              spellCheck={false}
            />
          </label>
          <label className="block col-span-2 md:col-span-1">
            <span className="text-slate-500">$orderby</span>
            <input
              className={clsx(INPUT, "mt-0.5")}
              placeholder={fields[0] ? `e.g. ${fields[0].name} desc` : target && !target.type ? "$it desc" : "Name desc"}
              value={draft.orderby ?? ""}
              onChange={(e) => setDraft({ ...draft, orderby: e.target.value || null })}
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className="text-slate-500">$top</span>
            <input
              className={clsx(INPUT, "mt-0.5")}
              type="number"
              min={1}
              max={500}
              value={draft.top}
              onChange={(e) => setDraft({ ...draft, top: Math.max(1, Math.min(500, Number(e.target.value) || 50)) })}
            />
          </label>
          <label className="block">
            <span className="text-slate-500">$skip</span>
            <input
              className={clsx(INPUT, "mt-0.5")}
              type="number"
              min={0}
              value={draft.skip}
              onChange={(e) => setDraft({ ...draft, skip: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 pb-1.5 whitespace-nowrap">
            <input type="checkbox" checked={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.checked })} />
            {v4 ? "$count" : "$inlinecount"}
          </label>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 select-none">More options ($expand{v4 ? ", $search" : ""}, custom parameters, credentials)</summary>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
            <label className="block">
              <span className="text-slate-500">$expand</span>
              <input className={clsx(INPUT, "mt-0.5")} placeholder={entityType && "navigation_properties" in entityType && entityType.navigation_properties[0] ? entityType.navigation_properties[0].name : ""} value={draft.expand ?? ""} onChange={(e) => setDraft({ ...draft, expand: e.target.value || null })} spellCheck={false} />
            </label>
            {v4 && (
              <label className="block">
                <span className="text-slate-500">$search</span>
                <input className={clsx(INPUT, "mt-0.5")} value={draft.search ?? ""} onChange={(e) => setDraft({ ...draft, search: e.target.value || null })} />
              </label>
            )}
            <label className="block">
              <span className="text-slate-500">Custom query parameters</span>
              <input className={clsx(INPUT, "mt-0.5")} placeholder="p_jahr=2025&sap-language=DE" value={draft.extra ?? ""} onChange={(e) => setDraft({ ...draft, extra: e.target.value || null })} spellCheck={false} />
            </label>
          </div>
          <div className={clsx("mt-2 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end rounded-md p-2", needAuth ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900" : "bg-slate-50 dark:bg-slate-900")}>
            <label className="block">
              <span className="text-slate-500">User name {needAuth && <strong className="text-amber-700 dark:text-amber-300">— the service asked for credentials</strong>}</span>
              <input className={clsx(INPUT, "mt-0.5")} autoComplete="username" value={credentials.username} onChange={(e) => setCredentials({ ...credentials, username: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-slate-500">Password</span>
              <input className={clsx(INPUT, "mt-0.5")} type="password" autoComplete="current-password" value={credentials.password} onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} />
            </label>
            <div className="flex gap-1.5">
              <button type="button" className="btn" onClick={() => setAuth(credentials.username ? credentials : null)}>
                {auth ? "Update" : "Use"} credentials
              </button>
              {auth && (
                <button type="button" className="btn" onClick={() => { setAuth(null); setCredentials({ username: "", password: "" }); }}>
                  Forget
                </button>
              )}
            </div>
            <p className="md:col-span-3 text-[11px] text-slate-500">
              {auth ? `Requests are sent as ${auth.username}. ` : "Requests are sent anonymously. "}
              Credentials stay in this tab's memory and travel to the service through this site's backend over HTTPS only.
            </p>
          </div>
        </details>
      </form>

      {data.trail.length > 0 && (
        <nav aria-label="Drill-down path" className="flex items-center gap-1.5 px-3 py-1.5 text-xs border-b border-slate-200 dark:border-slate-800 min-w-0">
          <button type="button" className="btn text-xs py-0.5 shrink-0" onClick={() => goBack()} disabled={data.loading}>
            ‹ Back
          </button>
          <ol className="flex items-center gap-1 min-w-0 overflow-x-auto font-mono whitespace-nowrap">
            {data.trail.map((level, depth) => (
              <li key={depth} className="flex items-center gap-1">
                <button type="button" className={DRILL} onClick={() => goBack(depth)} disabled={data.loading}>
                  {depth === 0 ? level.entitySet : (level.entitySet ?? "").slice((data.trail[depth - 1].entitySet ?? "").length)}
                </button>
                <span className="text-slate-400">›</span>
              </li>
            ))}
            <li className="text-slate-600 dark:text-slate-300" aria-current="page">
              {(data.entitySet ?? "").slice((data.trail[data.trail.length - 1].entitySet ?? "").length)}
            </li>
          </ol>
        </nav>
      )}

      {data.error && (
        <p className="px-3 py-2 text-sm text-red-700 dark:text-red-400 border-b border-red-100 dark:border-red-900/50 break-words" role="alert">
          {data.error}
        </p>
      )}

      {result && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-xs border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
          <span className="tabular-nums">
            {result.rows.length === 0 ? "No rows" : `Rows ${pageFrom}–${pageTo}`}
            {result.count !== null ? ` of ${result.count.toLocaleString()}` : ""}
          </span>
          <span className="text-slate-500">{result.duration_ms} ms · HTTP {result.status_code}</span>
          <span className={clsx("flex items-center gap-1 min-w-0 flex-1", !result.request_url && "invisible")}>
            <code className="font-mono truncate text-slate-600 dark:text-slate-300" title={result.request_url}>
              {result.request_url}
            </code>
            <button type="button" className="btn text-xs py-0.5 shrink-0" onClick={() => void copy(result.request_url)}>
              {copied ? <Icon name="check" size={14} /> : "Copy URL"}
            </button>
          </span>
          <span className="flex items-center gap-1 ml-auto">
            {result.rows.length > 0 && <ExportMenu rows={result.rows.length} all={!data.local} busy={exporting || data.loading} onExport={(scope) => void exportRows(scope)} />}
            <button type="button" className="btn text-xs py-0.5" onClick={() => setData({ rawView: !data.rawView })} aria-pressed={data.rawView}>
              {data.rawView ? "Table" : "JSON"}
            </button>
            <button type="button" className="btn text-xs py-0.5" disabled={data.pageStack.length === 0 || data.loading} onClick={previousPage}>
              ‹ Prev
            </button>
            <button
              type="button"
              className="btn text-xs py-0.5"
              disabled={data.loading || data.local || unpaged || (!result.next_link && result.rows.length < data.options.top)}
              onClick={nextPage}
            >
              Next ›
            </button>
          </span>
          {exportNote && (
            <span className={clsx("basis-full", exportNote.error ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400")} role={exportNote.error ? "alert" : undefined}>
              {exportNote.text}
            </span>
          )}
          {result.notices.map((n) => (
            <span key={n} className="basis-full text-amber-700 dark:text-amber-400">
              {n}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {!result && !data.loading && !data.error && (
          <p className="p-6 text-sm text-slate-500">
            Pick an entity set and press <strong>Run</strong>. The request goes through this site's backend, so services without CORS work too.
          </p>
        )}
        {result && data.rawView && (
          <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap break-all">{JSON.stringify(result.rows, null, 2)}</pre>
        )}
        {result && !data.rawView && result.rows.length > 0 && (
          <table className="min-w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 bg-white dark:bg-slate-950 z-[1]">
              <tr>
                <th className="text-right px-2 py-1 text-[10px] text-slate-400 border-b border-slate-200 dark:border-slate-800 w-8">#</th>
                {result.columns.map((c) => (
                  <th key={c} className="text-left px-2 py-1 font-semibold font-mono whitespace-nowrap border-b border-slate-200 dark:border-slate-800">
                    {c}
                    {fields.find((f) => f.name === c)?.isKey && <KeyIcon size={11} className="ml-1 inline align-[-1px]" />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="odd:bg-slate-50/60 dark:odd:bg-slate-900/40 hover:bg-blue-50/60 dark:hover:bg-blue-950/30">
                  <td className="text-right px-2 py-1 text-[10px] text-slate-400 tabular-nums align-top">{offset + i + 1}</td>
                  {result.columns.map((c) => (
                    <td key={c} className="px-2 py-1 whitespace-nowrap max-w-[28rem] overflow-hidden text-ellipsis align-top">
                      <CellView value={row[c] ?? null} onOpen={drillable(row[c]) ? () => openCell(row, c) : undefined} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
