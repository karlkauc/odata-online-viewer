import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ApiError, queryEntitySet } from "../../api/client";
import { effectiveMembers, shortType } from "../../lib/modelIndex";
import { useCopy } from "../../lib/useCopy";
import { useDismiss } from "../../lib/useDismiss";
import { DEFAULT_QUERY, useApp } from "../../stores/appStore";
import type { Auth, Cell, QueryOptions } from "../../types/model";
import { KindBadge } from "../KindBadge";

const INPUT =
  "w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs font-mono";

function CellView({ value }: { value: Cell }) {
  if (value === null || value === undefined) return <span className="text-slate-400 italic">null</span>;
  if (typeof value === "boolean") return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>;
  if (typeof value === "number") return <span className="tabular-nums text-blue-800 dark:text-blue-300">{String(value)}</span>;
  if (typeof value === "string") {
    if (value.length > 300) return <span title={value}>{value.slice(0, 300)}…</span>;
    return <>{value}</>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="text-slate-500" title={JSON.stringify(value, null, 2)}>
        [{value.length} item{value.length === 1 ? "" : "s"}]
      </span>
    );
  }
  if ("@link" in value && typeof value["@link"] === "string") {
    return <span className="text-slate-500 font-mono text-[11px]">→ {value["@link"]}</span>;
  }
  const text = JSON.stringify(value);
  return (
    <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300" title={JSON.stringify(value, null, 2)}>
      {text.length > 120 ? text.slice(0, 120) + "…" : text}
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
  const [credentials, setCredentials] = useState<Auth>({ username: auth?.username ?? "", password: auth?.password ?? "" });

  useEffect(() => setDraft(data.options), [data.options, data.entitySet]);

  const v4 = model?.odata_version.startsWith("4") ?? true;
  const sets = index?.entitySets ?? [];
  const current = sets.find((s) => s.set.name === data.entitySet) ?? null;
  const entityType = current && index ? index.typesByName.get(current.set.entity_type) : undefined;
  const fields = useMemo(() => {
    if (!index || !entityType || (entityType.kind !== "entity" && entityType.kind !== "complex")) return [];
    const key = new Set(entityType.kind === "entity" ? entityType.key : []);
    return effectiveMembers(index, entityType).properties.map((p) => ({ name: p.name, type: shortType(p.type), isKey: key.has(p.name) }));
  }, [index, entityType]);

  const run = useCallback(
    async (options: QueryOptions, nextLink: string | null = null, pageStack: number[] = data.pageStack) => {
      if (!model || !data.entitySet) return;
      setData({ loading: true, error: null, options, pageStack });
      try {
        const result = await queryEntitySet(model.metadata_id, data.entitySet, options, auth, nextLink);
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
    void run({ ...draft, skip: 0 }, null, []);
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
  const pageFrom = data.options.skip + 1;
  const pageTo = data.options.skip + (result?.rows.length ?? 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <form onSubmit={submit} className="border-b border-slate-200 dark:border-slate-800 p-3 space-y-2 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_auto] gap-2 items-end">
          <label className="block">
            <span className="text-slate-500">Entity set</span>
            <select
              className={clsx(INPUT, "mt-0.5")}
              value={data.entitySet ?? ""}
              onChange={(e) => {
                setData({ entitySet: e.target.value, result: null, error: null, pageStack: [], options: { ...DEFAULT_QUERY } });
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
            <button type="submit" className="btn btn-primary" disabled={data.loading}>
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
              placeholder={fields[0] ? `e.g. ${fields[0].name} desc` : "Name desc"}
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
          <span className="flex items-center gap-1 min-w-0 flex-1">
            <code className="font-mono truncate text-slate-600 dark:text-slate-300" title={result.request_url}>
              {result.request_url}
            </code>
            <button type="button" className="btn text-xs py-0.5 shrink-0" onClick={() => void copy(result.request_url)}>
              {copied ? "✓" : "Copy URL"}
            </button>
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <button type="button" className="btn text-xs py-0.5" onClick={() => setData({ rawView: !data.rawView })} aria-pressed={data.rawView}>
              {data.rawView ? "Table" : "JSON"}
            </button>
            <button type="button" className="btn text-xs py-0.5" disabled={data.pageStack.length === 0 || data.loading} onClick={previousPage}>
              ‹ Prev
            </button>
            <button
              type="button"
              className="btn text-xs py-0.5"
              disabled={data.loading || (!result.next_link && result.rows.length < data.options.top)}
              onClick={nextPage}
            >
              Next ›
            </button>
          </span>
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
                    {fields.find((f) => f.name === c)?.isKey && <span className="ml-1 text-[9px]">🔑</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="odd:bg-slate-50/60 dark:odd:bg-slate-900/40 hover:bg-blue-50/60 dark:hover:bg-blue-950/30">
                  <td className="text-right px-2 py-1 text-[10px] text-slate-400 tabular-nums align-top">{data.options.skip + i + 1}</td>
                  {result.columns.map((c) => (
                    <td key={c} className="px-2 py-1 whitespace-nowrap max-w-[28rem] overflow-hidden text-ellipsis align-top">
                      <CellView value={row[c] ?? null} />
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
