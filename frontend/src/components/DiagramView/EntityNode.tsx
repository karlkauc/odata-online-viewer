import { memo } from "react";
import clsx from "clsx";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GraphNode } from "./buildGraph";
import { KeyIcon } from "../Icon";

const HANDLE = "!opacity-0 !w-1 !h-1 !min-w-0 !min-h-0 !border-0 !pointer-events-none";

export type EntityNodeData = {
  graphNode: GraphNode;
  selected: boolean;
  dimmed: boolean;
  highlightedRow: string | null;
};

function EntityNodeComponent({ data }: NodeProps & { data: EntityNodeData }) {
  const { graphNode: node, selected, dimmed, highlightedRow } = data;
  const isComplex = node.kind === "complex";
  return (
    <div
      className={clsx(
        "rounded-md border bg-white dark:bg-slate-900 shadow-sm text-[12px] leading-5 overflow-hidden transition-opacity",
        selected
          ? "border-accent ring-2 ring-accent/40"
          : isComplex
            ? "border-violet-300 dark:border-violet-800"
            : "border-slate-300 dark:border-slate-700",
        dimmed && "opacity-30",
      )}
      style={{ width: node.width }}
    >
      {/* Edges attach on the side that faces the other node (see toFlow in DiagramView). */}
      <Handle id="l-t" type="target" position={Position.Left} className={HANDLE} />
      <Handle id="r-t" type="target" position={Position.Right} className={HANDLE} />
      <Handle id="l-s" type="source" position={Position.Left} className={HANDLE} />
      <Handle id="r-s" type="source" position={Position.Right} className={HANDLE} />
      <div
        className={clsx(
          "px-2 py-1.5 font-sans font-semibold flex items-center gap-1.5 border-b",
          isComplex
            ? "bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-900 text-violet-900 dark:text-violet-100"
            : "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-100",
        )}
        style={{ height: 34 }}
      >
        <span className={clsx("truncate", node.abstract && "italic")} title={node.type.qualified_name}>
          {node.title}
        </span>
        {node.subtitle && <span className="font-normal text-[11px] opacity-70 truncate">{node.subtitle}</span>}
        <span className="ml-auto text-[9px] uppercase tracking-wider opacity-60 font-sans">{isComplex ? "complex" : "entity"}</span>
      </div>
      {node.rows.length > 0 && (
        <ul className="py-1">
          {node.rows.map((row) => (
            <li
              key={row.id}
              className={clsx(
                "px-2 flex items-center gap-1.5 font-mono whitespace-nowrap",
                highlightedRow === row.id && "bg-blue-100 dark:bg-blue-900/50",
              )}
              style={{ height: 20 }}
            >
              <span className="w-3 shrink-0 flex">{row.isKey && <KeyIcon size={11} />}</span>
              <span className={clsx("truncate", row.isKey && "font-semibold")}>{row.name}</span>
              <span className="ml-auto text-slate-500 dark:text-slate-400 truncate text-[11px]">
                {row.type}
                {!row.nullable && !row.isKey ? " !" : ""}
              </span>
            </li>
          ))}
          {node.hiddenRows > 0 && (
            <li className="px-2 text-slate-400 italic font-sans text-[11px]" style={{ height: 20 }}>
              … {node.hiddenRows} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export const EntityNode = memo(EntityNodeComponent);
