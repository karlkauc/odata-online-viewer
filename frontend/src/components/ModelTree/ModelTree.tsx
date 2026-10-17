import { useCallback, useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useApp } from "../../stores/appStore";
import { KindBadge } from "../KindBadge";
import { buildTreeRows, expandableIds, type TreeRow } from "./treeRows";

const INDENT_PX = 14;

export function ModelTree() {
  const model = useApp((s) => s.model);
  const index = useApp((s) => s.index);
  const expandedIds = useApp((s) => s.expandedIds);
  const selectedId = useApp((s) => s.selectedId);
  const setSelected = useApp((s) => s.setSelected);
  const toggleExpanded = useApp((s) => s.toggleExpanded);
  const expandIds = useApp((s) => s.expandIds);
  const collapseAll = useApp((s) => s.collapseAll);
  const virtuoso = useRef<VirtuosoHandle | null>(null);

  const rows = useMemo(
    () => (model && index ? buildTreeRows(model, index, expandedIds) : []),
    [model, index, expandedIds],
  );

  // Keep the selected row in view when the selection comes from elsewhere
  // (search, diagram, deep link).
  useEffect(() => {
    if (!selectedId) return;
    const i = rows.findIndex((r) => r.id === selectedId);
    if (i >= 0) virtuoso.current?.scrollIntoView({ index: i, behavior: "auto", align: "center" });
  }, [selectedId, rows]);

  const onRowClick = useCallback(
    (row: TreeRow) => {
      if (row.kind === "group") {
        toggleExpanded(row.id);
        return;
      }
      if (row.selectId) setSelected(row.selectId);
      if (row.hasChildren && !row.expanded) toggleExpanded(row.id);
    },
    [setSelected, toggleExpanded],
  );

  if (!model) return null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-200 dark:border-slate-800 text-xs">
        <span className="font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-auto">Model</span>
        <button type="button" className="btn text-xs py-0.5" onClick={() => expandIds(expandableIds(model))} title="Expand all">
          Expand all
        </button>
        <button type="button" className="btn text-xs py-0.5" onClick={collapseAll} title="Collapse all">
          Collapse all
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <Virtuoso
          ref={virtuoso}
          data={rows}
          computeItemKey={(_, row) => row.id}
          itemContent={(_, row) => (
            <TreeRowView
              row={row}
              selected={row.selectId !== null && row.id === selectedId}
              onClick={() => onRowClick(row)}
              onToggle={(event) => {
                event.stopPropagation();
                toggleExpanded(row.id);
              }}
            />
          )}
        />
      </div>
    </div>
  );
}

function TreeRowView({
  row,
  selected,
  onClick,
  onToggle,
}: {
  row: TreeRow;
  selected: boolean;
  onClick: () => void;
  onToggle: (event: React.MouseEvent) => void;
}) {
  const isGroup = row.kind === "group";
  return (
    <div
      role="treeitem"
      aria-label={row.secondary ? `${row.label} ${row.secondary}` : row.label}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? row.expanded : undefined}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={clsx(
        "flex items-center gap-1.5 pr-2 py-[3px] touch:py-1.5 text-[13px] font-mono cursor-pointer select-none border-l-2",
        selected
          ? "bg-blue-50 dark:bg-blue-950/50 border-accent"
          : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-900",
      )}
      style={{ paddingLeft: 6 + row.depth * INDENT_PX }}
      title={row.secondary ? `${row.label} · ${row.secondary}` : row.label}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={row.expanded ? "Collapse" : "Expand"}
        className={clsx(
          "w-4 h-4 shrink-0 flex items-center justify-center text-[10px] text-slate-400 rounded hover:bg-slate-200 dark:hover:bg-slate-700",
          !row.hasChildren && "invisible",
        )}
        onClick={onToggle}
      >
        {row.expanded ? "▾" : "▸"}
      </button>
      {isGroup ? (
        <span className="text-[11px] font-sans font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {row.label}
        </span>
      ) : (
        <>
          <KindBadge kind={row.kind} />
          <span className={clsx("truncate", row.isKey && "font-semibold")}>{row.label}</span>
          {row.isKey && (
            <span aria-label="key" title="Key property" className="text-[10px]">
              🔑
            </span>
          )}
        </>
      )}
      {row.secondary && (
        <span
          className={clsx(
            "truncate text-slate-500 dark:text-slate-400",
            isGroup ? "font-sans text-[11px] tabular-nums" : "text-[12px]",
          )}
        >
          {row.secondary}
        </span>
      )}
      {row.badge && (
        <span className="chip ml-auto bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 normal-case tracking-normal font-sans">
          {row.badge}
        </span>
      )}
    </div>
  );
}
