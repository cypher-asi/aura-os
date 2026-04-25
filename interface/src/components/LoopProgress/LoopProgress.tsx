import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  selectAgentActivity,
  selectAgentInstanceActivity,
  selectProjectActivity,
  selectTaskActivity,
  useLoopActivityStore,
} from "../../stores/loop-activity-store";
import {
  type LoopActivityPayload,
  type LoopStatus,
  isLoopActivityActive,
} from "../../shared/types/aura-events";

/**
 * Single, reusable circular progress indicator for loop activity.
 *
 * All three rendering sites (agent list, sidekick tasks/runs top nav,
 * individual task rows) use this component so spinner styling and
 * semantics stay identical. The visual state maps from [`LoopStatus`]
 * as follows:
 *
 * - `starting` / `running` / `waiting_tool` / `compacting`: indeterminate
 *   spinner (when `percent` is null) or determinate arc (when `percent`
 *   is a number between 0 and 1).
 * - `stalled`: muted spinner (lower opacity) to surface "something is
 *   wrong but still technically running".
 * - `completed` / `failed` / `cancelled`: nothing rendered; terminal
 *   loops disappear from the indicator automatically via the activity
 *   store's `remove` handler on `loop_ended`.
 *
 * The component never subscribes to more than it needs; callers pass
 * one of `agentInstanceId` / `projectId` / `taskId` and the matching
 * selector drives the render. Each selector returns `null` when no
 * loop matches, which means this component returns `null` and takes
 * no space in the DOM.
 */
type LoopProgressSource =
  | { agentId: string }
  | { agentInstanceId: string }
  | { projectId: string }
  | { taskId: string }
  | { activity: LoopActivityPayload | null };

interface LoopProgressProps {
  /** Pick exactly one routing key; the component selects the matching
   *  activity from the store. Pass `activity: null` to hide the
   *  indicator entirely. */
  source: LoopProgressSource;
  /** Pixel size of the rendered SVG. Defaults to 14px to match the
   *  existing icon slots in tab bars and list rows. */
  size?: number;
  /** Stroke width as a fraction of `size`. Defaults to 0.14 which
   *  keeps the ring visible but slim at any size. */
  strokeRatio?: number;
  /** Override the accessible label. Defaults to a status-derived
   *  description (e.g. "running 42%"). */
  label?: string;
  /** Additional class names to forward to the root SVG element. */
  className?: string;
}

function useActivity(source: LoopProgressSource): LoopActivityPayload | null {
  const activity = useLoopActivityStore(
    useShallow((state) => {
      if ("activity" in source) return source.activity;
      if ("agentInstanceId" in source)
        return selectAgentInstanceActivity(state, source.agentInstanceId);
      if ("agentId" in source) return selectAgentActivity(state, source.agentId);
      if ("projectId" in source)
        return selectProjectActivity(state, source.projectId);
      return selectTaskActivity(state, source.taskId);
    }),
  );
  return activity;
}

function statusColor(status: LoopStatus): string {
  switch (status) {
    case "waiting_tool":
      return "var(--loop-progress-tool-color, #d7a41a)";
    case "compacting":
      return "var(--loop-progress-compact-color, #1abc9c)";
    case "stalled":
      return "var(--loop-progress-stalled-color, #9ca3af)";
    default:
      return "var(--loop-progress-color, #4f8bff)";
  }
}

function describe(activity: LoopActivityPayload): string {
  const pct =
    typeof activity.percent === "number"
      ? ` ${Math.round(activity.percent * 100)}%`
      : "";
  return `${activity.status.replace(/_/g, " ")}${pct}`;
}

/**
 * Circular progress indicator driven by [`LoopActivityPayload`].
 * Renders `null` when no loop matches the source, so it's safe to
 * drop into any layout unconditionally.
 */
export function LoopProgress({
  source,
  size = 14,
  strokeRatio = 0.14,
  label,
  className,
}: LoopProgressProps) {
  const activity = useActivity(source);
  const renderable = activity && isLoopActivityActive(activity.status);

  const geom = useMemo(() => {
    const stroke = Math.max(1, Math.round(size * strokeRatio));
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    return { stroke, radius, circumference };
  }, [size, strokeRatio]);

  if (!renderable || !activity) return null;

  const determinate =
    typeof activity.percent === "number" &&
    activity.percent >= 0 &&
    activity.percent <= 1;
  const dashOffset = determinate
    ? geom.circumference * (1 - (activity.percent ?? 0))
    : geom.circumference * 0.7;
  const color = statusColor(activity.status);
  const muted = activity.status === "stalled";
  const a11y = label ?? describe(activity);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={a11y}
      style={{
        opacity: muted ? 0.55 : 1,
        display: "inline-block",
        verticalAlign: "middle",
      }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={geom.radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={geom.stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={geom.radius}
        fill="none"
        stroke={color}
        strokeWidth={geom.stroke}
        strokeLinecap="round"
        strokeDasharray={geom.circumference}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={
          determinate
            ? undefined
            : {
                transformOrigin: `${size / 2}px ${size / 2}px`,
                animation: "loop-progress-spin 1.1s linear infinite",
              }
        }
      />
      <style>{`
        @keyframes loop-progress-spin {
          from { transform: rotate(-90deg); }
          to { transform: rotate(270deg); }
        }
      `}</style>
    </svg>
  );
}
