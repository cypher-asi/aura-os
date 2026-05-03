import type { ProcessRun } from "../../../../shared/types";
import { EmptyState } from "../../../../components/EmptyState";
import { injectKeyframes, useElapsedTime } from "./process-sidekick-utils";

export interface RunListProps {
  runs: ProcessRun[];
  onSelect: (r: ProcessRun) => void;
}

export function RunList({ runs, onSelect }: RunListProps) {
  injectKeyframes();
  if (runs.length === 0) return <EmptyState>No runs yet</EmptyState>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
      {runs.map((run) => {
        const isActive = run.status === "running" || run.status === "pending";
        return (
          <button
            key={run.run_id}
            type="button"
            onClick={() => onSelect(run)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
              borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)",
              background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--color-text)",
              textAlign: "left",
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: run.status === "completed" ? "var(--color-success)"
                : run.status === "failed" ? "var(--color-error)"
                : isActive ? "var(--color-node-running)"
                : "var(--color-text-muted)",
              ...(isActive ? { animation: "aura-pulse 1.5s ease-in-out infinite" } : {}),
            }} />
            <span style={{ flex: 1 }}>{run.trigger} &middot; {run.status}</span>
            {isActive
              ? <RunElapsedBadge startedAt={run.started_at} />
              : <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  {new Date(run.started_at).toLocaleString()}
                </span>
            }
          </button>
        );
      })}
    </div>
  );
}

function RunElapsedBadge({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedTime(startedAt, true);
  return (
    <span style={{ fontSize: 11, color: "var(--color-node-running)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
      {elapsed}
    </span>
  );
}
