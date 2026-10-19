import clsx from "clsx";
import { capabilities, hasCapabilityInfo, propertyHints, uiSummary, type FieldList } from "../lib/fiori";
import type { Annotation, Property } from "../types/model";
import { Icon } from "./Icon";

const TH = "text-left font-semibold text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 px-2 py-1";
const TD = "px-2 py-1 align-top";
const HEADING = "text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5";

/** What an entity set allows — Capabilities vocabulary (V4) or sap: attributes (V2). */
export function CapabilityMatrix({ annotations, properties }: { annotations: Annotation[]; properties: Property[] }) {
  const rows = capabilities(annotations, properties);
  if (!hasCapabilityInfo(rows)) return null;
  return (
    <section>
      <h3 className={HEADING}>Capabilities</h3>
      <table className="text-xs">
        <tbody>
          {rows.map((row) => (
            <tr key={row.operation} className="border-t border-slate-100 dark:border-slate-800">
              <td className={clsx(TD, "whitespace-nowrap")}>{row.operation}</td>
              <td className={clsx(TD, "whitespace-nowrap")}>
                {row.allowed === false ? (
                  <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
                    <Icon name="close" size={12} /> no
                  </span>
                ) : row.allowed === true ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                    <Icon name="check" size={12} /> yes
                  </span>
                ) : (
                  <span className="text-slate-500" title="Not restricted by an annotation; the OData default is allowed">
                    not restricted
                  </span>
                )}
              </td>
              <td className={clsx(TD, "text-slate-500 dark:text-slate-400")}>
                {row.details.length > 0 && <span className="block font-mono">{row.details.join(", ")}</span>}
                {row.source && <span className="font-mono text-[10px]">{row.source}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FieldTable({ list, labelFor }: { list: FieldList; labelFor: (path: string) => string | null }) {
  return (
    <div>
      <h4 className="text-xs font-medium mb-1">{list.title}</h4>
      {list.fields.length === 0 ? (
        <p className="text-xs text-slate-500">No fields.</p>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className={TH}>Label</th>
                <th className={TH}>Value</th>
                <th className={TH}>Kind</th>
              </tr>
            </thead>
            <tbody>
              {list.fields.map((f, i) => (
                <tr key={`${f.value}-${i}`} className="border-t border-slate-100 dark:border-slate-800">
                  <td className={TD}>{f.label ?? labelFor(f.value) ?? <span className="text-slate-400">—</span>}</td>
                  <td className={clsx(TD, "font-mono break-all")}>{f.value}</td>
                  <td className={clsx(TD, "text-slate-500 dark:text-slate-400")}>{f.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** UI vocabulary of an entity type: what a Fiori elements list report and object page show. */
export function FioriUi({ annotations, properties }: { annotations: Annotation[]; properties: Property[] }) {
  const summary = uiSummary(annotations);
  if (!summary) return null;
  const labels = new Map(properties.map((p) => [p.name, p.label]));
  const labelFor = (path: string) => labels.get(path) ?? null;
  const { header } = summary;
  return (
    <section className="space-y-3">
      <h3 className={HEADING}>Fiori UI annotations</h3>
      {header && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {header.typeName && (
            <>
              <dt className="text-slate-500">Object name</dt>
              <dd>
                {header.typeName}
                {header.typeNamePlural && <span className="text-slate-500"> / {header.typeNamePlural}</span>}
              </dd>
            </>
          )}
          {header.title && (
            <>
              <dt className="text-slate-500">Title</dt>
              <dd className="font-mono">{header.title}</dd>
            </>
          )}
          {header.description && (
            <>
              <dt className="text-slate-500">Subtitle</dt>
              <dd className="font-mono">{header.description}</dd>
            </>
          )}
        </dl>
      )}
      {summary.selectionFields.length > 0 && (
        <p className="text-xs">
          <span className="text-slate-500">Filter bar (UI.SelectionFields): </span>
          <span className="font-mono">{summary.selectionFields.join(", ")}</span>
        </p>
      )}
      {summary.lists.map((list) => (
        <FieldTable key={list.title} list={list} labelFor={labelFor} />
      ))}
    </section>
  );
}

/** Small chips for a property: text arrangement, value help, sap: flags. */
export function PropertyHints({ annotations }: { annotations: Annotation[] }) {
  const hints = propertyHints(annotations);
  if (hints.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1 mt-0.5">
      {hints.map((hint) => (
        <span key={hint} className="chip bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px]">
          {hint}
        </span>
      ))}
    </span>
  );
}
