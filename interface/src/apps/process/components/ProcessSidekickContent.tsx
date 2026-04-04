import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Text } from "@cypher-asi/zui";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
import type { ProcessArtifact, ProcessEvent, ProcessNode } from "../../../types";
import { processApi } from "../../../api/process";
import { desktopApi } from "../../../api/desktop";
import { EmptyState } from "../../../components/EmptyState";
import { PreviewOverlay } from "../../../components/PreviewOverlay";
import { ProcessEditorModal } from "./ProcessEditorModal";
import { NodeEditorModal } from "./NodeEditorModal";
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
import previewStyles from "../../../components/Preview/Preview.module.css";
import auraStyles from "../../../views/aura.module.css";

const EMPTY_RUNS: ProcessRun[] = [];

function ProcessInfoTab() {
  const { processId } = useParams<{ processId: string }>();
  const processes = useProcessStore((s) => s.processes);
  const process = processes.find((p) => p.process_id === processId);

  if (!process) return <EmptyState>No process selected</EmptyState>;

  return (
    <div className={previewStyles.previewBody}>
      <div className={previewStyles.taskMeta}>
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Name</span>
          <Text size="sm" style={{ fontWeight: 600 }}>{process.name}</Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Status</span>
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
        </div>

        {process.description && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Description</span>
            <Text variant="secondary" size="sm">{process.description}</Text>
          </div>
        )}

        {process.schedule && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Schedule</span>
            <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {process.schedule}
            </Text>
          </div>
        )}

        {process.tags.length > 0 && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Tags</span>
            <Text variant="secondary" size="sm">{process.tags.join(", ")}</Text>
          </div>
        )}

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Last Run</span>
          <Text variant="secondary" size="sm">
            {process.last_run_at ? new Date(process.last_run_at).toLocaleString() : "Never"}
          </Text>
        </div>

        <div className={previewStyles.taskField} style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, marginTop: 4 }}>
          <span className={previewStyles.fieldLabel}>Process ID</span>
          <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {process.process_id}
          </Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Created</span>
          <Text variant="secondary" size="sm">{new Date(process.created_at).toLocaleString()}</Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Updated</span>
          <Text variant="secondary" size="sm">{new Date(process.updated_at).toLocaleString()}</Text>
        </div>
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

const EVENT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  completed: { bg: "rgba(16,185,129,0.15)", fg: "#10b981" },
  failed: { bg: "rgba(239,68,68,0.15)", fg: "#ef4444" },
  skipped: { bg: "rgba(107,114,128,0.15)", fg: "#6b7280" },
  running: { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
  pending: { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
};

function EventTimelineItem({ event, nodes }: { event: ProcessEvent; nodes: { node_id: string; label: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const nodeLabel = nodes.find((n) => n.node_id === event.node_id)?.label ?? event.node_id.slice(0, 8);
  const colors = EVENT_STATUS_COLORS[event.status] ?? EVENT_STATUS_COLORS.pending;

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        fontSize: 12,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
          background: "transparent", border: "none", cursor: "pointer",
          width: "100%", textAlign: "left", color: "var(--color-text)",
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: colors.fg,
        }} />
        <span style={{ flex: 1, fontWeight: 600 }}>{nodeLabel}</span>
        <span style={{
          fontSize: 10, padding: "1px 6px", borderRadius: 0,
          background: colors.bg, color: colors.fg, fontWeight: 600,
        }}>
          {event.status}
        </span>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
          {event.output && (
            <div>
              <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 2 }}>Output</div>
              <div style={{
                background: "var(--color-bg-input)", padding: 6, borderRadius: "var(--radius-sm)",
                whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 11,
                maxHeight: 200, overflow: "auto", lineHeight: 1.4,
              }}>
                {event.output}
              </div>
            </div>
          )}
          {event.input_snapshot && (
            <div>
              <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 2 }}>Input</div>
              <div style={{
                background: "var(--color-bg-input)", padding: 6, borderRadius: "var(--radius-sm)",
                whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 11,
                maxHeight: 150, overflow: "auto", lineHeight: 1.4,
                color: "var(--color-text-muted)",
              }}>
                {event.input_snapshot}
              </div>
            </div>
          )}
          <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {event.started_at ? new Date(event.started_at).toLocaleString() : ""}
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY_NODES: ProcessNode[] = [];

function EventsTimeline({ processId }: { processId: string }) {
  const runs = useProcessStore((s) => s.runs[processId]) ?? EMPTY_RUNS;
  const nodes = useProcessStore((s) => s.nodes[processId]) ?? EMPTY_NODES;
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const latestRun = runs[0];
  const isRunActive = latestRun && (latestRun.status === "running" || latestRun.status === "pending");

  const loadEvents = useCallback(async () => {
    if (!latestRun) return;
    try {
      const evts = await processApi.listRunEvents(processId, latestRun.run_id);
      setEvents(evts);
    } catch { /* ignore */ }
  }, [processId, latestRun?.run_id]);

  useEffect(() => {
    setLoading(true);
    loadEvents().finally(() => setLoading(false));
  }, [loadEvents]);

  useEffect(() => {
    if (isRunActive) {
      intervalRef.current = setInterval(loadEvents, 4000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunActive, loadEvents]);

  if (!latestRun) return <EmptyState>No runs yet</EmptyState>;
  if (loading && events.length === 0) return <EmptyState>Loading events...</EmptyState>;
  if (events.length === 0) return <EmptyState>No events for this run</EmptyState>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
      <Text variant="secondary" size="sm" style={{ padding: "0 0 4px" }}>
        {latestRun.trigger} &middot; {latestRun.status} &middot; {new Date(latestRun.started_at).toLocaleString()}
      </Text>
      {events.map((evt) => (
        <EventTimelineItem key={evt.event_id} event={evt} nodes={nodes} />
      ))}
    </div>
  );
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "\u2014";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return "\u2014";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function artifactFilename(a: ProcessArtifact): string {
  const ext = a.file_path?.includes(".") ? a.file_path.slice(a.file_path.lastIndexOf(".")) : ".md";
  const base = a.name?.trim() || "artifact";
  return base.includes(".") ? base : `${base}${ext}`;
}

function RunPreviewBody({ run }: { run: ProcessRun }) {
  const nodes = useProcessStore((s) => s.nodes[run.process_id]) ?? EMPTY_NODES;
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([]);
  const [events, setEvents] = useState<ProcessEvent[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [artList, evtList] = await Promise.all([
        processApi.listRunArtifacts(run.process_id, run.run_id),
        processApi.listRunEvents(run.process_id, run.run_id),
      ]);
      setArtifacts(artList);
      setEvents(evtList);
    } catch { /* ignore */ }
  }, [run.process_id, run.run_id]);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <div style={{ padding: 12, fontSize: 13 }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px" }}>
        <span style={{ color: "var(--color-text-muted)" }}>Status</span><span>{run.status}</span>
        <span style={{ color: "var(--color-text-muted)" }}>Trigger</span><span>{run.trigger}</span>
        <span style={{ color: "var(--color-text-muted)" }}>Started</span><span>{new Date(run.started_at).toLocaleString()}</span>
        <span style={{ color: "var(--color-text-muted)" }}>Completed</span><span>{run.completed_at ? new Date(run.completed_at).toLocaleString() : "\u2014"}</span>
        <span style={{ color: "var(--color-text-muted)" }}>Duration</span><span>{formatDuration(run.started_at, run.completed_at)}</span>
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
            {artifacts.map((a) => {
              const displayName = a.name?.trim() || a.file_path?.split("/").pop() || "Untitled artifact";
              return (
                <div
                  key={a.artifact_id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "6px 8px", border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)", fontSize: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{displayName}</div>
                    <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
                      {a.artifact_type} &middot; {(a.size_bytes / 1024).toFixed(1)} KB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const content = await processApi.getArtifactContent(a.artifact_id);
                        const blob = new Blob([content], { type: "text/plain" });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = artifactFilename(a);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        console.error("Failed to download artifact:", err);
                      }
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
              );
            })}
          </div>
        </div>
      )}
      {events.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Node Events</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {[...events].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()).map((evt) => (
              <EventTimelineItem key={evt.event_id} event={evt} nodes={nodes} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProcessSidekickContent() {
  const { processId } = useParams<{ processId: string }>();
  const { activeTab, activeNodeTab, previewRun, selectedNode, showEditor, nodeEditRequested, viewRun, closePreview, closeEditor, clearNodeEditRequested } =
    useProcessSidekickStore(
      useShallow((s) => ({
        activeTab: s.activeTab,
        activeNodeTab: s.activeNodeTab,
        previewRun: s.previewRun,
        selectedNode: s.selectedNode,
        showEditor: s.showEditor,
        nodeEditRequested: s.nodeEditRequested,
        viewRun: s.viewRun,
        closePreview: s.closePreview,
        closeEditor: s.closeEditor,
        clearNodeEditRequested: s.clearNodeEditRequested,
      })),
    );

  const processes = useProcessStore((s) => s.processes);
  const runs = useProcessStore((s) => (processId ? s.runs[processId] ?? EMPTY_RUNS : EMPTY_RUNS));
  const process = processes.find((p) => p.process_id === processId);

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
        <NodeEditorModal
          isOpen={nodeEditRequested}
          node={selectedNode}
          onClose={clearNodeEditRequested}
        />
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
          {activeTab === "events" && <EventsTimeline processId={processId} />}
          {activeTab === "stats" && <StatsView runs={runs} />}
          {activeTab === "log" && <EmptyState>Activity log coming soon</EmptyState>}
        </div>
      </div>
      {process && (
        <ProcessEditorModal isOpen={showEditor} process={process} onClose={closeEditor} />
      )}
    </div>
  );
}
