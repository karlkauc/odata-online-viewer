import type { ViewMode } from "../stores/appStore";
import { Icon, type IconName } from "./Icon";

// On phones the model tree is a pane of its own next to the content views.
export type MobilePane = "tree" | ViewMode;

const PANES: { pane: MobilePane; label: string; icon: IconName }[] = [
  { pane: "tree", label: "Tree", icon: "tree" },
  { pane: "details", label: "Details", icon: "details" },
  { pane: "diagram", label: "Diagram", icon: "diagram" },
  { pane: "data", label: "Data", icon: "data" },
  { pane: "source", label: "Source", icon: "source" },
];

export function MobileNav({ pane, onChange }: { pane: MobilePane; onChange: (pane: MobilePane) => void }) {
  return (
    <nav
      aria-label="Panes"
      className="md:hidden shrink-0 flex border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 pb-[env(safe-area-inset-bottom)]"
    >
      {PANES.map((p) => (
        <button
          key={p.pane}
          type="button"
          aria-pressed={pane === p.pane}
          onClick={() => onChange(p.pane)}
          className={
            "flex-1 flex flex-col items-center gap-0.5 py-2 touch:py-2.5 text-xs font-medium " +
            (pane === p.pane ? "text-accent" : "text-slate-500 dark:text-slate-400")
          }
        >
          <Icon name={p.icon} size={20} />
          {p.label}
        </button>
      ))}
    </nav>
  );
}
