import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { ArrowLeft } from "lucide-react";
import { Button, Text } from "@cypher-asi/zui";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
import { EmptyState } from "../../../components/EmptyState";
import type { ProcessRun } from "../../../types";
import styles from "../../../components/Sidekick/Sidekick.module.css";

const EMPTY_RUNS: ProcessRun[] = [];

function RunList({ runs, onSelect }: { runs: ProcessRun[]; onSelect: (r: ProcessRun) => void }) {
  if (runs.length === 0) return <EmptyState>No runs yet</EmptyState>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
      {runs.map((run) => (
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
            width: 8, height: 8, borderRadius: "50%",
            background: run.status === "completed" ? "var(--color-success)"
              : run.status === "failed" ? "var(--color-error)"
              : "var(--color-text-muted)",
          }} />
          <span style={{ flex: 1 }}>{run.trigger} &middot; {run.status}</span>
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            {new Date(run.started_at).toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  );
}

function RunPreview({ run, onClose }: { run: ProcessRun; onClose: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
        <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={onClose} />
        <Text size="sm">Run Detail</Text>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12, fontSize: 13 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px" }}>
          <span style={{ color: "var(--color-text-muted)" }}>Status</span><span>{run.status}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Trigger</span><span>{run.trigger}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Started</span><span>{new Date(run.started_at).toLocaleString()}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Completed</span><span>{run.completed_at ? new Date(run.completed_at).toLocaleString() : "\u2014"}</span>
        </div>
        {run.error && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--color-error)" }}>Error</div>
            <div style={{ background: "var(--color-bg-input)", padding: 8, borderRadius: "var(--radius-sm)", whiteSpace: "pre-wrap" }}>{run.error}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProcessSidekickContent() {
  const { processId } = useParams<{ processId: string }>();
  const { activeTab, previewRun, viewRun, closePreview } = useProcessSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      previewRun: s.previewRun,
      viewRun: s.viewRun,
      closePreview: s.closePreview,
    })),
  );

  const runs = useProcessStore((s) => (processId ? s.runs[processId] ?? EMPTY_RUNS : EMPTY_RUNS));

  if (!processId) {
    return (
      <div className={styles.sidekickBody}>
        <EmptyState>Select a process</EmptyState>
      </div>
    );
  }

  if (previewRun) {
    return (
      <div className={styles.sidekickBody}>
        <div className={styles.previewOverlay}>
          <RunPreview run={previewRun} onClose={closePreview} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sidekickBody}>
      <div className={styles.sidekickContent}>
        <div className={styles.tabContent}>
          {activeTab === "process" && <EmptyState>Process overview</EmptyState>}
          {activeTab === "runs" && <RunList runs={runs} onSelect={viewRun} />}
          {activeTab === "events" && <EmptyState>Select a run to view events</EmptyState>}
          {activeTab === "stats" && <EmptyState>Stats coming soon</EmptyState>}
          {activeTab === "log" && <EmptyState>Activity log coming soon</EmptyState>}
        </div>
      </div>
    </div>
  );
}
