import clsx from "clsx";
import type { NodeKind } from "../lib/modelIndex";

export type BadgeKind = NodeKind | "group" | "member" | "param" | "key";

const STYLE: Record<BadgeKind, { text: string; className: string; title: string }> = {
  schema: { text: "NS", className: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200", title: "Schema (namespace)" },
  container: { text: "EC", className: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200", title: "Entity container" },
  set: { text: "ES", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200", title: "Entity set" },
  singleton: { text: "SG", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200", title: "Singleton" },
  import: { text: "FI", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200", title: "Function / action import" },
  entity: { text: "ET", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200", title: "Entity type" },
  complex: { text: "CT", className: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200", title: "Complex type" },
  enum: { text: "EN", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200", title: "Enum type" },
  typedef: { text: "TD", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200", title: "Type definition" },
  op: { text: "FN", className: "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200", title: "Function / action" },
  prop: { text: "P", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", title: "Property" },
  nav: { text: "N", className: "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200", title: "Navigation property" },
  group: { text: "", className: "", title: "" },
  member: { text: "M", className: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", title: "Enum member" },
  param: { text: "PA", className: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300", title: "Parameter" },
  key: { text: "🔑", className: "", title: "Key property" },
};

export function KindBadge({ kind, text, className }: { kind: BadgeKind; text?: string; className?: string }) {
  const style = STYLE[kind];
  if (!style.text && !text) return null;
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center shrink-0 min-w-[1.6rem] px-1 h-[1.15rem] rounded text-[0.62rem] font-semibold tracking-wide uppercase font-sans",
        style.className,
        className,
      )}
      title={style.title}
      aria-label={style.title}
    >
      {text ?? style.text}
    </span>
  );
}
