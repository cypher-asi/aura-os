import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
import type { ProcessArtifact } from "../../../types";
import { processApi } from "../../../api/process";
import { EmptyState } from "../../../components/EmptyState";
import { PreviewOverlay } from "../../../components/PreviewOverlay";
import { NodeInfoTab } from "./NodeInfoTab";
import { NodeConfigTab } from "./NodeConfigTab";
import { NodeConnectionsTab } from "./NodeConnectionsTab";
import { NodeOutputTab } from "./NodeOutputTab";
import {
  StatCard,
  SectionHeader,
  StatsGrid,
  ProgressBar,
  cx,
} from "../../../components/StatCard";
import type { ProcessRun } from "../../../types";
import styles from "../../../components/Sidekick/Sidekick.module.css";
import auraStyles from "../../../views/aura.module.css";

const EMPTY_RUNS: ProcessRun[] = [];

function ProcessInfoTab() {
  const { processId } = useParams<{ processId: string }>();
  const processes = useProcessStore((s) => s.processes);
  const process = processes.find((p) => p.process_id === processId);

  if (!process) return <EmptyState>No process selected</EmptyState>;

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px" }}>
        <span style={{ color: "var(--color-text-muted)" }}>Name</span>
        <span style={{ fontWeight: 600 }}>{process.name}</span>

        <span style={{ color: "var(--color-text-muted)" }}>Status</span>
        <span>
          <span
            style={{
              display: "inline-block",
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 0,
              background: process.enabled ? "rgba(16,185,129,0.15)" : "rgba(107,114,128,0.15)",
              color: process.enabled ? "#10b981" : "#6b7280",
              fontWeight: 600,
            }}
          >
            {process.enabled ? "Active" : "Paused"}
          </span>
        </span>

        {process.description && (
          <>
            <span style={{ color: "var(--color-text-muted)" }}>Description</span>
            <span>{process.description}</span>
          </>
        )}

        {process.schedule && (
          <>
            <span style={{ color: "var(--color-text-muted)" }}>Schedule</span>
            <span style={{ fontFamily: "monospace", fontSize: 12 }}>{process.schedule}</span>
          </>
        )}

        {process.tags.length > 0 && (
          <>
            <span style={{ color: "var(--color-text-muted)" }}>Tags</span>
            <span>{process.tags.join(", ")}</span>
          </>
        )}

        <span style={{ color: "var(--color-text-muted)" }}>Last Run</span>
        <span>{process.last_run_at ? new Date(process.last_run_at).toLocaleString() : "Never"}</span>

        <span style={{ color: "var(--color-text-muted)" }}>Created</span>
        <span>{new Date(process.created_at).toLocaleString()}</span>

        <span style={{ color: "var(--color-text-muted)" }}>Updated</span>
        <span>{new Date(process.updated_at).toLocaleString()}</span>
      </div>
    </div>
  );
}

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

function StatsView({ runs }: { runs: ProcessRun[] }) {
  const total = runs.length;
  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const running = runs.filter((r) => r.status === "running").length;
  const successRate = total > 0 ? (completed / total) * 100 : 0;

  return (
    <div className={cx(auraStyles.dashboardPadding)}>
      <SectionHeader first>Success Rate</SectionHeader>
      <ProgressBar percentage={successRate} />

      <SectionHeader>Runs</SectionHeader>
      <StatsGrid>
        <StatCard value={total} label="Total" />
        <StatCard value={completed} label="Completed" />
        <StatCard value={failed} label="Failed" />
        <StatCard value={running} label="Running" />
      </StatsGrid>
    </div>
  );
}

function RunPreviewBody({ run }: { run: ProcessRun }) {
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([]);

  const loadArtifacts = useCallback(async () => {
    try {
      const list = await processApi.listRunArtifacts(run.process_id, run.run_id);
      setArtifacts(list);
    } catch { /* ignore */ }
  }, [run.process_id, run.run_id]);

  useEffect(() => { loadArtifacts(); }, [loadArtifacts]);

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
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
      {artifacts.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Artifacts</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {artifacts.map((a) => (
              <div
                key={a.artifact_id}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "6px 8px", border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)", fontSize: 12,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                    {a.artifact_type} &middot; {(a.size_bytes / 1024).toFixed(1)} KB
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const content = await processApi.getArtifactContent(a.artifact_id);
                      const blob = new Blob([content as unknown as string], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = `${a.name}.md`;
                      link.click();
                      URL.revokeObjectURL(url);
                    } catch { /* ignore */ }
                  }}
                  style={{
                    background: "transparent", border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)", padding: "4px 8px", cursor: "pointer",
                    fontSize: 11, color: "var(--color-text)",
                  }}
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProcessSidekickContent() {
  const { processId } = useParams<{ processId: string }>();
  const { activeTab, activeNodeTab, previewRun, selectedNode, viewRun, closePreview } =
    useProcessSidekickStore(
      useShallow((s) => ({
        activeTab: s.activeTab,
        activeNodeTab: s.activeNodeTab,
        previewRun: s.previewRun,
        selectedNode: s.selectedNode,
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

  if (selectedNode) {
    return (
      <div className={styles.sidekickBody}>
        <div className={styles.sidekickContent}>
          <div className={styles.tabContent}>
            {activeNodeTab === "info" && <NodeInfoTab node={selectedNode} />}
            {activeNodeTab === "config" && <NodeConfigTab node={selectedNode} />}
            {activeNodeTab === "connections" && <NodeConnectionsTab node={selectedNode} />}
            {activeNodeTab === "output" && <NodeOutputTab node={selectedNode} />}
          </div>
        </div>
      </div>
    );
  }

  if (previewRun) {
    return (
      <div className={styles.sidekickBody}>
        <PreviewOverlay title="Run Detail" onClose={closePreview} fullLane>
          <RunPreviewBody run={previewRun} />
        </PreviewOverlay>
      </div>
    );
  }

  return (
    <div className={styles.sidekickBody}>
      <div className={styles.sidekickContent}>
        <div className={styles.tabContent}>
          {activeTab === "process" && <ProcessInfoTab />}
          {activeTab === "runs" && <RunList runs={runs} onSelect={viewRun} />}
          {activeTab === "events" && <EmptyState>Select a run to view events</EmptyState>}
          {activeTab === "stats" && <StatsView runs={runs} />}
          {activeTab === "log" && <EmptyState>Activity log coming soon</EmptyState>}
        </div>
      </div>
    </div>
  );
}
