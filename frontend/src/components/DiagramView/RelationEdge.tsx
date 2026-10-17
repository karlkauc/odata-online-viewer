import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export interface RelationEdgeData {
  sourceLabel: string | null;
  targetLabel: string | null;
  selectId: string | null;
  dimmed: boolean;
  [key: string]: unknown;
}

const LABEL =
  "absolute pointer-events-none font-mono text-[10px] leading-none px-1 py-0.5 rounded bg-white/90 dark:bg-slate-900/90 text-slate-700 dark:text-slate-200";

/** Smooth-step edge with the navigation name in the middle and the
 * multiplicities (1, 0..1, *) next to each end. */
function RelationEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  markerStart,
  style,
  label,
  data,
  interactionWidth,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
  const d = data as RelationEdgeData | undefined;
  const opacity = d?.dimmed ? 0.25 : 1;
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} markerStart={markerStart} style={style} interactionWidth={interactionWidth ?? 16} />
      <EdgeLabelRenderer>
        {label && (
          <div className={LABEL} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, opacity }}>
            {label}
          </div>
        )}
        {d?.sourceLabel && (
          <div className={LABEL} style={{ transform: `translate(0, -100%) translate(${sourceX + 4}px, ${sourceY - 3}px)`, opacity }}>
            {d.sourceLabel}
          </div>
        )}
        {d?.targetLabel && (
          <div className={LABEL} style={{ transform: `translate(-100%, -100%) translate(${targetX - 8}px, ${targetY - 3}px)`, opacity }}>
            {d.targetLabel}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const RelationEdge = memo(RelationEdgeComponent);
