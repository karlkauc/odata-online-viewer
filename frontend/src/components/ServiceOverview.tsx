import { downloadExport } from "../api/client";
import { shareLink } from "../lib/deepLink";
import { useCopy } from "../lib/useCopy";
import { useApp } from "../stores/appStore";
import { KindBadge } from "./KindBadge";

function Stat({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

/** Shown in the details pane while nothing is selected. */
export function ServiceOverview() {
  const model = useApp((s) => s.model);
  const index = useApp((s) => s.index);
  const setSelected = useApp((s) => s.setSelected);
  const openData = useApp((s) => s.openData);
  const setViewMode = useApp((s) => s.setViewMode);
  const { copied, copy } = useCopy();
  if (!model || !index) return null;
  const s = model.stats;
  const sets = index.entitySets;
  const share = model.service_root && !model.auth_used ? shareLink(model.service_root, null, null) : null;

  return (
    <div className="p-4 space-y-4 text-sm">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold break-all">{model.service_root ?? model.filename}</h2>
          <span className="chip bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">OData {model.odata_version}</span>
          <span className="chip bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
            {model.format === "json" ? "CSDL JSON" : `EDMX ${model.edmx_version ?? ""}`}
          </span>
          {model.auth_used && <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">authenticated</span>}
        </div>
        {model.metadata_url && model.metadata_url !== model.service_root && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 break-all">{model.metadata_url}</p>
        )}
        {model.notices.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-amber-700 dark:text-amber-400" role="status">
            {model.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
        <Stat label="Entity sets" value={s.entity_set_count} />
        <Stat label="Entity types" value={s.entity_type_count} />
        <Stat label="Navigations" value={s.navigation_count} />
        <Stat label="Properties" value={s.property_count} />
        <Stat label="Complex types" value={s.complex_type_count} />
        <Stat label="Enum types" value={s.enum_type_count} />
        <Stat label="Singletons" value={s.singleton_count} />
        <Stat label="Functions & actions" value={s.operation_count} />
        <Stat label="Annotations" value={s.annotation_count} />
        <Stat label="Schemas" value={s.schema_count} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => setViewMode("diagram")}>
          🕸 Open diagram
        </button>
        {sets.length > 0 && model.service_root && (
          <button type="button" className="btn" onClick={() => openData(sets[0].set.name)}>
            📊 Browse data
          </button>
        )}
        <button type="button" className="btn" onClick={() => void downloadExport(model.metadata_id, "markdown")}>
          ⬇ Markdown docs
        </button>
        <button type="button" className="btn" onClick={() => void downloadExport(model.metadata_id, "mermaid")}>
          ⬇ Mermaid ER
        </button>
        {share && (
          <button type="button" className="btn" onClick={() => void copy(share)} title={share}>
            {copied ? "✓ Link copied" : "🔗 Copy share link"}
          </button>
        )}
      </div>

      {sets.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Entity sets</h3>
          <div className="flex flex-wrap gap-1.5">
            {sets.slice(0, 60).map(({ set }) => (
              <button
                key={set.id}
                type="button"
                className="inline-flex items-center gap-1.5 rounded border border-slate-200 dark:border-slate-800 px-2 py-1 text-xs font-mono hover:border-accent"
                onClick={() => setSelected(set.id)}
                title={set.entity_type}
              >
                <KindBadge kind="set" />
                {set.name}
              </button>
            ))}
            {sets.length > 60 && <span className="text-xs text-slate-500 self-center">… and {sets.length - 60} more in the tree</span>}
          </div>
        </section>
      )}

      {model.service_root && (
        <section className="rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 text-xs text-slate-600 dark:text-slate-400">
          <p className="font-medium text-slate-700 dark:text-slate-300 mb-1">Use this service in Excel or Power BI</p>
          <p>
            Excel: <em>Data → Get Data → From Other Sources → From OData Feed</em>, paste{" "}
            <code className="font-mono break-all">{model.service_root}</code>
            {model.auth_used ? " and choose Basic authentication." : "."} Power BI Desktop: <em>Get Data → OData feed</em>. Each entity
            set becomes a table.
          </p>
        </section>
      )}

      {model.references.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">References</h3>
          <ul className="space-y-1 text-xs">
            {model.references.map((ref) => (
              <li key={ref.uri} className="break-all">
                <span className="font-mono">{ref.uri}</span>
                {ref.includes.length > 0 && (
                  <span className="text-slate-500"> — {ref.includes.map((i) => (i.alias ? `${i.namespace} as ${i.alias}` : i.namespace)).join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
