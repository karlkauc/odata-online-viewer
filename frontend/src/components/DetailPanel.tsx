import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  baseChain,
  effectiveMembers,
  operationsBoundTo,
  primarySet,
  shortType,
  stripCollection,
  type IndexEntry,
  type ModelIndex,
} from "../lib/modelIndex";
import { useApp } from "../stores/appStore";
import type {
  Annotation,
  EntityContainer,
  EntitySet,
  EnumType,
  NavigationProperty,
  Operation,
  OperationImport,
  Property,
  Schema,
  Singleton,
  StructuredType,
  TypeDefinition,
} from "../types/model";
import { KindBadge } from "./KindBadge";
import { ServiceOverview } from "./ServiceOverview";
import { Icon, KeyIcon } from "./Icon";

// --- small building blocks --------------------------------------------------

function Section({ title, children, count }: { title: string; children: ReactNode; count?: number }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
        {title}
        {count !== undefined && <span className="ml-1.5 tabular-nums normal-case font-normal">({count})</span>}
      </h3>
      {children}
    </section>
  );
}

function Chip({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "blue" | "amber" | "teal" }) {
  const tones = {
    slate: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    teal: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
  };
  return <span className={clsx("chip", tones[tone])}>{children}</span>;
}

/** A type name that jumps to its definition when the model declares it. */
export function TypeLink({ type, index }: { type: string; index: ModelIndex }) {
  const setSelected = useApp((s) => s.setSelected);
  const { base, collection } = stripCollection(type);
  const target = index.typesByName.get(base);
  const label = shortType(type);
  if (!target) {
    return (
      <span className="font-mono" title={type}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="font-mono text-accent hover:underline text-left"
      title={type}
      onClick={() => setSelected(target.id)}
    >
      {collection ? `Collection(${target.name})` : target.name}
    </button>
  );
}

function AnnotationList({ annotations }: { annotations: Annotation[] }) {
  const [open, setOpen] = useState(false);
  if (annotations.length === 0) return null;
  return (
    <section>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <Icon name={open ? "chevronDown" : "chevronRight"} size={12} /> Annotations ({annotations.length})
      </button>
      {open && (
        <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1 text-xs">
          {annotations.map((a, i) => (
            <div key={`${a.term}-${i}`} className="contents">
              <dt className="font-mono text-slate-500 dark:text-slate-400 break-all">
                {a.term}
                {a.qualifier ? `#${a.qualifier}` : ""}
              </dt>
              <dd className="font-mono break-all">{a.value ?? <span className="text-slate-400">—</span>}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Header({
  kind,
  name,
  qualified,
  chips,
  label,
  description,
  line,
}: {
  kind: Parameters<typeof KindBadge>[0]["kind"];
  name: string;
  qualified?: string | null;
  chips?: ReactNode;
  label?: string | null;
  description?: string | null;
  line?: number | null;
}) {
  const jumpToSource = useApp((s) => s.jumpToSource);
  const format = useApp((s) => s.model?.format);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <KindBadge kind={kind} />
        <h2 className="text-base font-semibold font-mono break-all">{name}</h2>
        {chips}
        {line && format === "xml" && (
          <button
            type="button"
            className="ml-auto btn text-xs py-0.5"
            onClick={() => jumpToSource(line)}
            title={`Show line ${line} of the $metadata source`}
          >
            Source · line {line}
          </button>
        )}
      </div>
      {qualified && qualified !== name && <p className="text-xs text-slate-500 dark:text-slate-400 font-mono break-all mt-0.5">{qualified}</p>}
      {(label || description) && (
        <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">
          {label && <span className="font-medium">{label}</span>}
          {label && description && " — "}
          {description}
        </p>
      )}
    </div>
  );
}

function facets(p: { max_length: number | null; max_length_is_max?: boolean; precision: number | null; scale: number | string | null; default_value?: string | null; unicode?: boolean | null; srid?: string | null }): string {
  const parts: string[] = [];
  if (p.max_length !== null) parts.push(`len ${p.max_length}`);
  if (p.max_length_is_max) parts.push("len max");
  if (p.precision !== null) parts.push(`prec ${p.precision}`);
  if (p.scale !== null) parts.push(`scale ${p.scale}`);
  if (p.default_value !== null && p.default_value !== undefined) parts.push(`default ${p.default_value}`);
  if (p.unicode === false) parts.push("non-unicode");
  if (p.srid) parts.push(`SRID ${p.srid}`);
  return parts.join(" · ");
}

const TH = "text-left font-semibold text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 px-2 py-1";
const TD = "px-2 py-1 align-top";

// --- structured type --------------------------------------------------------

function StructuredDetails({ type, index, highlightId }: { type: StructuredType; index: ModelIndex; highlightId: string | null }) {
  const setSelected = useApp((s) => s.setSelected);
  const openData = useApp((s) => s.openData);
  const setViewMode = useApp((s) => s.setViewMode);
  const setDiagram = useApp((s) => s.setDiagram);
  const serviceRoot = useApp((s) => s.model?.service_root);
  const members = useMemo(() => effectiveMembers(index, type), [index, type]);
  const chain = useMemo(() => baseChain(index, type), [index, type]);
  const derived = index.derivedTypes.get(type.qualified_name) ?? [];
  const sets = index.setsByType.get(type.qualified_name) ?? [];
  const bound = operationsBoundTo(index, type.qualified_name);
  const usedBy = index.usedBy.get(type.qualified_name) ?? [];
  const key = type.kind === "entity" ? new Set(type.key) : new Set<string>();
  const set = type.kind === "entity" ? primarySet(index, type.qualified_name) : null;

  return (
    <div className="space-y-4">
      <Header
        kind={type.kind}
        name={type.name}
        qualified={type.qualified_name}
        label={type.label}
        description={type.description}
        line={type.line}
        chips={
          <>
            {type.abstract && <Chip tone="amber">abstract</Chip>}
            {type.open_type && <Chip>open type</Chip>}
            {type.kind === "entity" && type.has_stream && <Chip>media entity</Chip>}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {type.base_type && (
          <span>
            extends <TypeLink type={type.base_type} index={index} />
            {chain.length > 1 && (
              <span className="text-slate-500">
                {" "}
                ({chain
                  .slice(1)
                  .map((t) => t.name)
                  .join(" → ")})
              </span>
            )}
          </span>
        )}
        {type.kind === "entity" && (
          <span>
            key:{" "}
            {type.key.length ? (
              <span className="font-mono">
                {type.key.join(", ")}
                {type.key_inherited && <span className="text-slate-500"> (inherited)</span>}
              </span>
            ) : (
              <span className="text-slate-500">none</span>
            )}
          </span>
        )}
        <span className="ml-auto flex gap-1.5">
          <button
            type="button"
            className="btn text-xs py-0.5"
            onClick={() => {
              setDiagram({ focus: true });
              setViewMode("diagram");
            }}
          >
            <Icon name="focus" size={14} /> Focus in diagram
          </button>
          {set && serviceRoot && (
            <button type="button" className="btn text-xs py-0.5" onClick={() => openData(set.name)}>
              <Icon name="data" size={14} /> Browse {set.name}
            </button>
          )}
        </span>
      </div>

      <Section title="Properties" count={members.properties.length}>
        {members.properties.length === 0 ? (
          <p className="text-xs text-slate-500">No structural properties.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  <th className={TH}>Name</th>
                  <th className={TH}>Type</th>
                  <th className={TH}>Null</th>
                  <th className={TH}>Facets</th>
                  <th className={TH}>Label</th>
                </tr>
              </thead>
              <tbody>
                {members.properties.map((p) => (
                  <tr
                    key={p.id}
                    className={clsx(
                      "border-t border-slate-100 dark:border-slate-800",
                      highlightId === p.id && "bg-blue-50 dark:bg-blue-950/40",
                      p.from !== type && "text-slate-500 dark:text-slate-400",
                    )}
                    onClick={() => setSelected(p.id)}
                  >
                    <td className={clsx(TD, "font-mono whitespace-nowrap")}>
                      {key.has(p.name) && (
                        <span title="Key" className="mr-1 inline-flex align-[-1px]">
                          <KeyIcon />
                        </span>
                      )}
                      {p.name}
                      {p.from !== type && <span className="ml-1 text-[10px]">↑ {p.from.name}</span>}
                    </td>
                    <td className={clsx(TD, "whitespace-nowrap")}>
                      <TypeLink type={p.type} index={index} />
                    </td>
                    <td className={TD}>{p.nullable ? "yes" : <span className="font-medium">no</span>}</td>
                    <td className={clsx(TD, "text-slate-500 dark:text-slate-400 whitespace-nowrap")}>{facets(p)}</td>
                    <td className={TD}>
                      {p.label}
                      {p.description && <span className="block text-slate-500 dark:text-slate-400">{p.description}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {members.navigations.length > 0 && (
        <Section title="Navigation properties" count={members.navigations.length}>
          <div className="overflow-x-auto -mx-1">
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  <th className={TH}>Name</th>
                  <th className={TH}>Target</th>
                  <th className={TH} title="this side → target side">
                    Multiplicity
                  </th>
                  <th className={TH}>Partner</th>
                  <th className={TH}>Constraints</th>
                </tr>
              </thead>
              <tbody>
                {members.navigations.map((n) => (
                  <tr
                    key={n.id}
                    className={clsx(
                      "border-t border-slate-100 dark:border-slate-800",
                      highlightId === n.id && "bg-blue-50 dark:bg-blue-950/40",
                      n.from !== type && "text-slate-500 dark:text-slate-400",
                    )}
                    onClick={() => setSelected(n.id)}
                  >
                    <td className={clsx(TD, "font-mono whitespace-nowrap")}>
                      {n.name}
                      {n.contains_target && <Chip tone="teal">contained</Chip>}
                      {n.from !== type && <span className="ml-1 text-[10px]">↑ {n.from.name}</span>}
                    </td>
                    <td className={clsx(TD, "whitespace-nowrap")}>
                      <TypeLink type={n.target_type} index={index} />
                    </td>
                    <td className={clsx(TD, "font-mono whitespace-nowrap")}>
                      {n.source_multiplicity ?? "?"} → {n.multiplicity}
                    </td>
                    <td className={clsx(TD, "font-mono")}>{n.partner ?? ""}</td>
                    <td className={clsx(TD, "font-mono")}>
                      {n.referential_constraints.map((c) => `${c.property} → ${c.referenced_property}`).join(", ")}
                      {n.on_delete && <span className="text-slate-500"> · on delete {n.on_delete}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {(sets.length > 0 || derived.length > 0 || bound.length > 0 || usedBy.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sets.length > 0 && (
            <Section title="Exposed as">
              <div className="flex flex-wrap gap-1.5">
                {sets.map((s) => (
                  <button key={s.id} type="button" className="btn text-xs py-0.5 font-mono" onClick={() => setSelected(s.id)}>
                    <KindBadge kind={s.kind} /> {s.name}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {derived.length > 0 && (
            <Section title="Derived types">
              <div className="flex flex-wrap gap-1.5">
                {derived.map((d) => (
                  <button key={d.id} type="button" className="btn text-xs py-0.5 font-mono" onClick={() => setSelected(d.id)}>
                    <KindBadge kind={d.kind} /> {d.name}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {bound.length > 0 && (
            <Section title="Bound functions & actions">
              <div className="flex flex-wrap gap-1.5">
                {bound.map((op) => (
                  <button key={op.id} type="button" className="btn text-xs py-0.5 font-mono" onClick={() => setSelected(op.id)}>
                    <KindBadge kind="op" text={op.kind === "action" ? "AC" : "FN"} /> {op.name}
                  </button>
                ))}
              </div>
            </Section>
          )}
          {usedBy.length > 0 && (
            <Section title="Used by">
              <div className="flex flex-wrap gap-1.5">
                {usedBy.map((t) => (
                  <button key={t.id} type="button" className="btn text-xs py-0.5 font-mono" onClick={() => setSelected(t.id)}>
                    <KindBadge kind={t.kind} /> {t.name}
                  </button>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      <AnnotationList annotations={type.annotations} />
    </div>
  );
}

// --- members ----------------------------------------------------------------

function PropertyCard({ prop, owner, index }: { prop: Property; owner: StructuredType; index: ModelIndex }) {
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3 space-y-2">
      <Header
        kind="prop"
        name={prop.name}
        qualified={`${owner.qualified_name}/${prop.name}`}
        label={prop.label}
        description={prop.description}
        line={prop.line}
        chips={prop.is_key && <Chip tone="blue">key</Chip>}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-slate-500">Type</dt>
        <dd>
          <TypeLink type={prop.type} index={index} />
        </dd>
        <dt className="text-slate-500">Nullable</dt>
        <dd>{prop.nullable ? "yes" : "no"}</dd>
        {facets(prop) && (
          <>
            <dt className="text-slate-500">Facets</dt>
            <dd>{facets(prop)}</dd>
          </>
        )}
      </dl>
      <AnnotationList annotations={prop.annotations} />
    </div>
  );
}

function NavigationCard({ nav, owner, index }: { nav: NavigationProperty; owner: StructuredType; index: ModelIndex }) {
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 p-3 space-y-2">
      <Header
        kind="nav"
        name={nav.name}
        qualified={`${owner.qualified_name}/${nav.name}`}
        label={nav.label}
        description={nav.description}
        line={nav.line}
        chips={nav.contains_target && <Chip tone="teal">containment</Chip>}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-slate-500">Target</dt>
        <dd>
          <TypeLink type={nav.target_type} index={index} />
          {nav.is_collection && <span className="text-slate-500"> (collection)</span>}
        </dd>
        <dt className="text-slate-500">Multiplicity</dt>
        <dd className="font-mono">
          {owner.name} {nav.source_multiplicity ?? "?"} → {nav.multiplicity} {shortType(nav.target_type)}
        </dd>
        {nav.partner && (
          <>
            <dt className="text-slate-500">Partner</dt>
            <dd className="font-mono">{nav.partner}</dd>
          </>
        )}
        {nav.relationship && (
          <>
            <dt className="text-slate-500">Association</dt>
            <dd className="font-mono break-all">{nav.relationship}</dd>
          </>
        )}
        {nav.referential_constraints.length > 0 && (
          <>
            <dt className="text-slate-500">Constraints</dt>
            <dd className="font-mono">{nav.referential_constraints.map((c) => `${c.property} → ${c.referenced_property}`).join(", ")}</dd>
          </>
        )}
      </dl>
      <AnnotationList annotations={nav.annotations} />
    </div>
  );
}

// --- other kinds ------------------------------------------------------------

function SetDetails({ set, index }: { set: EntitySet | Singleton; index: ModelIndex }) {
  const openData = useApp((s) => s.openData);
  const setSelected = useApp((s) => s.setSelected);
  const serviceRoot = useApp((s) => s.model?.service_root);
  const type = index.typesByName.get(set.entity_type);
  return (
    <div className="space-y-4">
      <Header kind={set.kind} name={set.name} label={set.label} description={set.description} line={set.line} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-slate-500">Entity type</dt>
        <dd>
          <TypeLink type={set.entity_type} index={index} />
        </dd>
        {set.kind === "set" && !set.include_in_service_document && (
          <>
            <dt className="text-slate-500">Service document</dt>
            <dd>hidden (IncludeInServiceDocument=false)</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        {serviceRoot && (
          <button type="button" className="btn btn-primary text-xs" onClick={() => openData(set.name)}>
            <Icon name="data" size={14} /> Browse data
          </button>
        )}
        {type && (type.kind === "entity" || type.kind === "complex") && (
          <button type="button" className="btn text-xs" onClick={() => setSelected(type.id)}>
            Show type {type.name}
          </button>
        )}
      </div>
      {set.navigation_bindings.length > 0 && (
        <Section title="Navigation property bindings" count={set.navigation_bindings.length}>
          <table className="text-xs">
            <tbody>
              {set.navigation_bindings.map((b) => (
                <tr key={b.path} className="border-t border-slate-100 dark:border-slate-800">
                  <td className={clsx(TD, "font-mono")}>{b.path}</td>
                  <td className={clsx(TD, "text-slate-500")}>→</td>
                  <td className={clsx(TD, "font-mono")}>{b.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      <AnnotationList annotations={set.annotations} />
    </div>
  );
}

function EnumDetails({ en }: { en: EnumType }) {
  return (
    <div className="space-y-4">
      <Header
        kind="enum"
        name={en.name}
        qualified={en.qualified_name}
        label={en.label}
        description={en.description}
        line={en.line}
        chips={
          <>
            <Chip>{shortType(en.underlying_type)}</Chip>
            {en.is_flags && <Chip tone="amber">flags</Chip>}
          </>
        }
      />
      <Section title="Members" count={en.members.length}>
        <table className="text-xs min-w-[16rem]">
          <thead>
            <tr>
              <th className={TH}>Name</th>
              <th className={TH}>Value</th>
              <th className={TH}>Label</th>
            </tr>
          </thead>
          <tbody>
            {en.members.map((m) => (
              <tr key={m.name} className="border-t border-slate-100 dark:border-slate-800">
                <td className={clsx(TD, "font-mono")}>{m.name}</td>
                <td className={clsx(TD, "font-mono tabular-nums")}>{m.value ?? ""}</td>
                <td className={TD}>{m.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <AnnotationList annotations={en.annotations} />
    </div>
  );
}

function TypeDefDetails({ td, index }: { td: TypeDefinition; index: ModelIndex }) {
  const usedBy = index.usedBy.get(td.qualified_name) ?? [];
  const setSelected = useApp((s) => s.setSelected);
  return (
    <div className="space-y-4">
      <Header kind="typedef" name={td.name} qualified={td.qualified_name} label={td.label} description={td.description} line={td.line} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-slate-500">Underlying type</dt>
        <dd className="font-mono">{td.underlying_type}</dd>
        {facets(td) && (
          <>
            <dt className="text-slate-500">Facets</dt>
            <dd>{facets(td)}</dd>
          </>
        )}
      </dl>
      {usedBy.length > 0 && (
        <Section title="Used by">
          <div className="flex flex-wrap gap-1.5">
            {usedBy.map((t) => (
              <button key={t.id} type="button" className="btn text-xs py-0.5 font-mono" onClick={() => setSelected(t.id)}>
                <KindBadge kind={t.kind} /> {t.name}
              </button>
            ))}
          </div>
        </Section>
      )}
      <AnnotationList annotations={td.annotations} />
    </div>
  );
}

function OperationDetails({ op, index }: { op: Operation; index: ModelIndex }) {
  const kindLabel = op.kind === "function_import" ? "Function import (V2)" : op.kind === "action" ? "Action" : "Function";
  return (
    <div className="space-y-4">
      <Header
        kind="op"
        name={op.name}
        qualified={op.qualified_name}
        label={op.label}
        description={op.description}
        line={op.line}
        chips={
          <>
            <Chip tone={op.kind === "action" ? "amber" : "slate"}>{kindLabel}</Chip>
            {op.is_bound && <Chip tone="teal">bound</Chip>}
            {op.is_composable && <Chip>composable</Chip>}
            {op.http_method && <Chip>{op.http_method}</Chip>}
          </>
        }
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {op.bound_to && (
          <>
            <dt className="text-slate-500">Bound to</dt>
            <dd>
              <TypeLink type={op.bound_to} index={index} />
            </dd>
          </>
        )}
        <dt className="text-slate-500">Returns</dt>
        <dd>{op.return_type ? <TypeLink type={op.return_type.type} index={index} /> : <span className="text-slate-500">nothing</span>}</dd>
        {op.entity_set && (
          <>
            <dt className="text-slate-500">Entity set</dt>
            <dd className="font-mono">{op.entity_set}</dd>
          </>
        )}
        {op.entity_set_path && (
          <>
            <dt className="text-slate-500">Entity set path</dt>
            <dd className="font-mono">{op.entity_set_path}</dd>
          </>
        )}
      </dl>
      <Section title="Parameters" count={op.parameters.length}>
        {op.parameters.length === 0 ? (
          <p className="text-xs text-slate-500">No parameters.</p>
        ) : (
          <table className="text-xs min-w-[20rem]">
            <thead>
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Type</th>
                <th className={TH}>Null</th>
                <th className={TH}>Facets</th>
                {op.kind === "function_import" && <th className={TH}>Mode</th>}
              </tr>
            </thead>
            <tbody>
              {op.parameters.map((p, i) => (
                <tr key={p.name} className="border-t border-slate-100 dark:border-slate-800">
                  <td className={clsx(TD, "font-mono")}>
                    {p.name}
                    {op.is_bound && i === 0 && <span className="ml-1 text-[10px] text-slate-500">(binding)</span>}
                  </td>
                  <td className={TD}>
                    <TypeLink type={p.type} index={index} />
                  </td>
                  <td className={TD}>{p.nullable ? "yes" : "no"}</td>
                  <td className={clsx(TD, "text-slate-500")}>{facets(p)}</td>
                  {op.kind === "function_import" && <td className={TD}>{p.mode}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <AnnotationList annotations={op.annotations} />
    </div>
  );
}

function ImportDetails({ imp, index }: { imp: OperationImport; index: ModelIndex }) {
  const setSelected = useApp((s) => s.setSelected);
  const target = index.entries.find((e) => e.kind === "op" && e.qualifiedName === imp.operation);
  return (
    <div className="space-y-4">
      <Header
        kind="import"
        name={imp.name}
        line={imp.line}
        chips={<Chip tone={imp.kind === "action_import" ? "amber" : "slate"}>{imp.kind === "action_import" ? "Action import" : "Function import"}</Chip>}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-slate-500">Operation</dt>
        <dd>
          {target ? (
            <button type="button" className="font-mono text-accent hover:underline" onClick={() => setSelected(target.id)}>
              {imp.operation}
            </button>
          ) : (
            <span className="font-mono">{imp.operation}</span>
          )}
        </dd>
        {imp.entity_set && (
          <>
            <dt className="text-slate-500">Entity set</dt>
            <dd className="font-mono">{imp.entity_set}</dd>
          </>
        )}
      </dl>
      <AnnotationList annotations={imp.annotations} />
    </div>
  );
}

function ContainerDetails({ container, index }: { container: EntityContainer; index: ModelIndex }) {
  const setSelected = useApp((s) => s.setSelected);
  return (
    <div className="space-y-4">
      <Header
        kind="container"
        name={container.name}
        qualified={container.qualified_name}
        line={container.line}
        chips={container.is_default && <Chip tone="blue">default container</Chip>}
      />
      {container.extends && (
        <p className="text-xs">
          extends <span className="font-mono">{container.extends}</span>
        </p>
      )}
      <Section title="Entity sets" count={container.entity_sets.length}>
        <table className="text-xs min-w-[20rem]">
          <tbody>
            {container.entity_sets.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900" onClick={() => setSelected(s.id)}>
                <td className={clsx(TD, "font-mono")}>{s.name}</td>
                <td className={TD}>
                  <TypeLink type={s.entity_type} index={index} />
                </td>
                <td className={clsx(TD, "text-slate-500")}>{s.label}</td>
              </tr>
            ))}
            {container.singletons.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800 cursor-pointer" onClick={() => setSelected(s.id)}>
                <td className={clsx(TD, "font-mono")}>
                  {s.name} <Chip>singleton</Chip>
                </td>
                <td className={TD}>
                  <TypeLink type={s.entity_type} index={index} />
                </td>
                <td className={TD} />
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <AnnotationList annotations={container.annotations} />
    </div>
  );
}

function SchemaDetails({ schema }: { schema: Schema }) {
  return (
    <div className="space-y-4">
      <Header kind="schema" name={schema.namespace} line={schema.line} chips={schema.alias && <Chip>alias {schema.alias}</Chip>} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-slate-500">Entity types</dt>
        <dd>{schema.entity_types.length}</dd>
        <dt className="text-slate-500">Complex types</dt>
        <dd>{schema.complex_types.length}</dd>
        <dt className="text-slate-500">Enum types</dt>
        <dd>{schema.enum_types.length}</dd>
        <dt className="text-slate-500">Functions & actions</dt>
        <dd>{schema.operations.length}</dd>
        <dt className="text-slate-500">Containers</dt>
        <dd>{schema.containers.map((c) => c.name).join(", ") || "—"}</dd>
      </dl>
      <AnnotationList annotations={schema.annotations} />
    </div>
  );
}

// --- entry ------------------------------------------------------------------

function render(entry: IndexEntry, index: ModelIndex) {
  switch (entry.kind) {
    case "entity":
    case "complex":
      return <StructuredDetails type={entry.node as StructuredType} index={index} highlightId={null} />;
    case "prop":
      return (
        <div className="space-y-4">
          <PropertyCard prop={entry.node as Property} owner={entry.owner!} index={index} />
          <StructuredDetails type={entry.owner!} index={index} highlightId={entry.id} />
        </div>
      );
    case "nav":
      return (
        <div className="space-y-4">
          <NavigationCard nav={entry.node as NavigationProperty} owner={entry.owner!} index={index} />
          <StructuredDetails type={entry.owner!} index={index} highlightId={entry.id} />
        </div>
      );
    case "set":
    case "singleton":
      return <SetDetails set={entry.node as EntitySet | Singleton} index={index} />;
    case "enum":
      return <EnumDetails en={entry.node as EnumType} />;
    case "typedef":
      return <TypeDefDetails td={entry.node as TypeDefinition} index={index} />;
    case "op":
      return <OperationDetails op={entry.node as Operation} index={index} />;
    case "import":
      return <ImportDetails imp={entry.node as OperationImport} index={index} />;
    case "container":
      return <ContainerDetails container={entry.node as EntityContainer} index={index} />;
    case "schema":
      return <SchemaDetails schema={entry.node as Schema} />;
    default:
      return null;
  }
}

export function DetailPanel() {
  const index = useApp((s) => s.index);
  const selectedId = useApp((s) => s.selectedId);
  const setSelected = useApp((s) => s.setSelected);
  const entry = selectedId && index ? index.byId.get(selectedId) : undefined;
  if (!index) return null;
  if (!entry) return <ServiceOverview />;
  return (
    <div className="p-4 text-sm">
      <button type="button" className="text-xs text-slate-500 hover:text-accent mb-3" onClick={() => setSelected(null)}>
        ← Service overview
      </button>
      {render(entry, index)}
    </div>
  );
}

