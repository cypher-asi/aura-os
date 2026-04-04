import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Text } from "@cypher-asi/zui";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
import { useAgentStore } from "../../agents/stores/agent-store";
import { useEventStore } from "../../../stores/event-store";
import { EventType } from "../../../types/aura-events";
import type { ProcessArtifact, ProcessEvent, ProcessNode, ProcessRun } from "../../../types";
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
import styles from "../../../components/Sidekick/Sidekick.module.css";
import previewStyles from "../../../components/Preview/Preview.module.css";
import auraStyles from "../../../views/aura.module.css";

const EMPTY_RUNS: ProcessRun[] = [];
const EMPTY_NODES: ProcessNode[] = [];

const pulseKeyframes = `
@keyframes aura-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.6; }
}
@keyframes aura-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

function injectKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById("aura-process-keyframes")) return;
  const style = document.createElement("style");
  style.id = "aura-process-keyframes";
  style.textContent = pulseKeyframes;
  document.head.appendChild(style);
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function useElapsedTime(startedAt: string, isActive: boolean): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// ProcessInfoTab
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// RunList
// ---------------------------------------------------------------------------

function RunList({ runs, onSelect }: { runs: ProcessRun[]; onSelect: (r: ProcessRun) => void }) {
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
                : isActive ? "#3b82f6"
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
    <span style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
      {elapsed}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatsView
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// EventTimelineItem
// ---------------------------------------------------------------------------

const EVENT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  completed: { bg: "rgba(16,185,129,0.15)", fg: "#10b981" },
  failed: { bg: "rgba(239,68,68,0.15)", fg: "#ef4444" },
  skipped: { bg: "rgba(107,114,128,0.15)", fg: "#6b7280" },
  running: { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
  pending: { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
};

function EventTimelineItem({
  event,
  nodes,
  isLive,
}: {
  event: ProcessEvent;
  nodes: { node_id: string; label: string }[];
  isLive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = event.status === "running";

  useEffect(() => {
    if (isLive && isRunning) setExpanded(true);
  }, [isLive, isRunning]);

  const nodeLabel = nodes.find((n) => n.node_id === event.node_id)?.label ?? event.node_id.slice(0, 8);
  const colors = EVENT_STATUS_COLORS[event.status] ?? EVENT_STATUS_COLORS.pending;

  const hasTokens = event.input_tokens != null || event.output_tokens != null;
  const totalTokens = (event.input_tokens ?? 0) + (event.output_tokens ?? 0);

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        fontSize: 12,
        overflow: "hidden",
        animation: isLive ? "aura-fade-in 0.3s ease-out" : undefined,
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
          ...(isRunning ? { animation: "aura-pulse 1.5s ease-in-out infinite" } : {}),
        }} />
        <span style={{ flex: 1, fontWeight: 600 }}>{nodeLabel}</span>
        {hasTokens && !isRunning && (
          <span style={{ fontSize: 10, color: "var(--color-text-muted)", marginRight: 4 }}>
            {formatTokens(totalTokens)} tok
          </span>
        )}
        {event.model && !isRunning && (
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 3,
            background: "rgba(107,114,128,0.1)", color: "var(--color-text-muted)",
            marginRight: 4,
          }}>
            {event.model}
          </span>
        )}
        {isRunning
          ? <NodeElapsedBadge startedAt={event.started_at} />
          : <span style={{
              fontSize: 10, padding: "1px 6px", borderRadius: 0,
              background: colors.bg, color: colors.fg, fontWeight: 600,
            }}>
              {event.status}
            </span>
        }
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
          {isRunning && (
            <div style={{ fontSize: 11, color: "#3b82f6", fontStyle: "italic" }}>
              Processing...
            </div>
          )}
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
          {hasTokens && (
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "var(--color-text-muted)" }}>
              {event.input_tokens != null && <span>In: {formatTokens(event.input_tokens)}</span>}
              {event.output_tokens != null && <span>Out: {formatTokens(event.output_tokens)}</span>}
              {event.model && <span>Model: {event.model}</span>}
            </div>
          )}
          <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {event.started_at ? new Date(event.started_at).toLocaleString() : ""}
            {event.started_at && event.completed_at && ` \u2022 ${formatDuration(event.started_at, event.completed_at)}`}
          </div>
        </div>
      )}
    </div>
  );
}

function NodeElapsedBadge({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedTime(startedAt, true);
  return (
    <span style={{
      fontSize: 10, padding: "1px 6px", borderRadius: 0,
      background: "rgba(59,130,246,0.15)", color: "#3b82f6", fontWeight: 600,
      fontFamily: "var(--font-mono)",
    }}>
      {elapsed}
    </span>
  );
}

// ---------------------------------------------------------------------------
// EventsTimeline
// ---------------------------------------------------------------------------

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
        <EventTimelineItem key={evt.event_id} event={evt} nodes={nodes} isLive={isRunActive} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ArtifactCard
// ---------------------------------------------------------------------------

function ArtifactCard({ artifact }: { artifact: ProcessArtifact }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const displayName = artifact.name?.trim() || artifact.file_path?.split("/").pop() || "Untitled artifact";

  const loadAndExpand = useCallback(async () => {
    if (expanded) { setExpanded(false); return; }
    if (content !== null) { setExpanded(true); return; }
    setLoading(true);
    try {
      const text = await processApi.getArtifactContent(artifact.artifact_id);
      setContent(text);
      setExpanded(true);
    } catch (err) {
      console.error("Failed to load artifact content:", err);
    } finally {
      setLoading(false);
    }
  }, [artifact.artifact_id, content, expanded]);

  const handleShowInFolder = useCallback(async () => {
    try {
      const { path } = await processApi.getArtifactPath(artifact.artifact_id);
      const parentDir = path.replace(/[\\/][^\\/]*$/, "");
      await desktopApi.openPath(parentDir);
    } catch (err) {
      console.error("Failed to show artifact in folder:", err);
    }
  }, [artifact.artifact_id]);

  const btnStyle: React.CSSProperties = {
    background: "transparent", border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)", padding: "4px 8px", cursor: "pointer",
    fontSize: 11, color: "var(--color-text)",
  };

  return (
    <div style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", fontSize: 12, overflow: "hidden" }}>
      <button
        type="button"
        onClick={loadAndExpand}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 8px", width: "100%", background: "transparent",
          border: "none", cursor: "pointer", color: "var(--color-text)", textAlign: "left",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{displayName}</div>
          <div style={{ color: "var(--color-text-muted)", fontSize: 11 }}>
            {artifact.artifact_type} &middot; {(artifact.size_bytes / 1024).toFixed(1)} KB
          </div>
        </div>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)", flexShrink: 0 }}>
          {loading ? "\u2026" : expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>
      {expanded && content !== null && (
        <div style={{ borderTop: "1px solid var(--color-border)" }}>
          <div style={{
            padding: 8, maxHeight: 300, overflow: "auto",
            whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)",
            fontSize: 11, lineHeight: 1.5, background: "var(--color-bg-input)",
          }}>
            {content}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px", borderTop: "1px solid var(--color-border)" }}>
            <button type="button" onClick={handleShowInFolder} style={btnStyle}>
              Show in Folder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LiveRunBanner
// ---------------------------------------------------------------------------

function LiveRunBanner({
  run,
  events,
  totalNodes,
}: {
  run: ProcessRun;
  events: ProcessEvent[];
  totalNodes: number;
}) {
  injectKeyframes();
  const liveRunNodeId = useProcessSidekickStore((s) => s.liveRunNodeId);
  const nodes = useProcessStore((s) => s.nodes[run.process_id]) ?? EMPTY_NODES;
  const agents = useAgentStore((s) => s.agents);
  const elapsed = useElapsedTime(run.started_at, true);

  const completedCount = events.filter(
    (e) => e.status === "completed" || e.status === "failed" || e.status === "skipped",
  ).length;

  const currentNode = liveRunNodeId ? nodes.find((n) => n.node_id === liveRunNodeId) : null;
  const currentAgent = currentNode?.agent_id
    ? agents.find((a) => a.agent_id === currentNode.agent_id)
    : null;

  const runningTokens = events.reduce(
    (acc, e) => ({
      input: acc.input + (e.input_tokens ?? 0),
      output: acc.output + (e.output_tokens ?? 0),
    }),
    { input: 0, output: 0 },
  );
  const totalTokens = runningTokens.input + runningTokens.output;
  const estimatedCost = runningTokens.input * 3 / 1_000_000 + runningTokens.output * 15 / 1_000_000;

  return (
    <div style={{
      padding: "10px 12px",
      borderBottom: "1px solid var(--color-border)",
      background: "rgba(59,130,246,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", background: "#3b82f6",
          animation: "aura-pulse 1.5s ease-in-out infinite", flexShrink: 0,
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#3b82f6" }}>Running</span>
        <span style={{
          fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)",
          color: "var(--color-text)", marginLeft: "auto",
        }}>
          {elapsed}
        </span>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
      }}>
        <div style={{
          flex: 1, height: 4, borderRadius: 2,
          background: "rgba(59,130,246,0.15)", overflow: "hidden",
        }}>
          <div style={{
            width: totalNodes > 0 ? `${(completedCount / totalNodes) * 100}%` : "0%",
            height: "100%", borderRadius: 2, background: "#3b82f6",
            transition: "width 0.5s ease-out",
          }} />
        </div>
        <span style={{ fontSize: 11, color: "var(--color-text-muted)", flexShrink: 0 }}>
          {completedCount}/{totalNodes}
        </span>
      </div>

      {currentNode && (
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>
          {currentAgent ? (
            <><span style={{ fontWeight: 600, color: "var(--color-text)" }}>{currentAgent.name}</span> working on </>
          ) : null}
          <span style={{ fontWeight: 500 }}>{currentNode.label}</span>
        </div>
      )}

      {totalTokens > 0 && (
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--color-text-muted)" }}>
          <span>{formatTokens(totalTokens)} tokens</span>
          <span>~{formatCost(estimatedCost)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunPreviewBody
// ---------------------------------------------------------------------------

function RunPreviewBody({ run: initialRun }: { run: ProcessRun }) {
  injectKeyframes();
  const [run, setRun] = useState(initialRun);
  const nodes = useProcessStore((s) => s.nodes[run.process_id]) ?? EMPTY_NODES;
  const fetchRuns = useProcessStore((s) => s.fetchRuns);
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([]);
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = run.status === "running" || run.status === "pending";

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

  const refreshRun = useCallback(async () => {
    try {
      const updated = await processApi.getRun(run.process_id, run.run_id);
      setRun(updated);
      if (updated.status !== "running" && updated.status !== "pending") {
        fetchRuns(run.process_id);
      }
    } catch { /* ignore */ }
  }, [run.process_id, run.run_id, fetchRuns]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!isActive) return;
    pollRef.current = setInterval(loadData, 2000);
    runPollRef.current = setInterval(refreshRun, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (runPollRef.current) clearInterval(runPollRef.current);
    };
  }, [isActive, loadData, refreshRun]);

  useEffect(() => {
    const unsub1 = useEventStore.getState().subscribe(EventType.ProcessNodeExecuted, (event) => {
      if (event.content.run_id === run.run_id) {
        loadData();
      }
    });
    const unsub2 = useEventStore.getState().subscribe(EventType.ProcessRunCompleted, (event) => {
      if (event.content.run_id === run.run_id) {
        refreshRun();
        loadData();
      }
    });
    const unsub3 = useEventStore.getState().subscribe(EventType.ProcessRunFailed, (event) => {
      if (event.content.run_id === run.run_id) {
        refreshRun();
        loadData();
      }
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [run.run_id, loadData, refreshRun]);

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()),
    [events],
  );

  const models = useMemo(() => {
    const set = new Set<string>();
    for (const evt of events) {
      if (evt.model) set.add(evt.model);
    }
    return [...set];
  }, [events]);

  const totalTokensFromEvents = useMemo(() => {
    let input = 0;
    let output = 0;
    for (const evt of events) {
      input += evt.input_tokens ?? 0;
      output += evt.output_tokens ?? 0;
    }
    return { input, output, total: input + output };
  }, [events]);

  return (
    <div style={{ fontSize: 13 }}>
      {isActive && (
        <LiveRunBanner
          run={run}
          events={events}
          totalNodes={nodes.length}
        />
      )}

      <div style={{ padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px" }}>
          <span style={{ color: "var(--color-text-muted)" }}>Status</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {isActive && (
              <span style={{
                width: 6, height: 6, borderRadius: "50%", background: "#3b82f6",
                animation: "aura-pulse 1.5s ease-in-out infinite",
              }} />
            )}
            {run.status}
          </span>
          <span style={{ color: "var(--color-text-muted)" }}>Trigger</span><span>{run.trigger}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Started</span><span>{new Date(run.started_at).toLocaleString()}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Duration</span>
          <span>{run.completed_at ? formatDuration(run.started_at, run.completed_at) : isActive ? <ActiveDurationCell startedAt={run.started_at} /> : "\u2014"}</span>
        </div>

        {(run.total_input_tokens != null || run.total_output_tokens != null || totalTokensFromEvents.total > 0) && (
          <div style={{ marginTop: 12, padding: "8px 0", borderTop: "1px solid var(--color-border)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px" }}>
              <span style={{ color: "var(--color-text-muted)" }}>Tokens</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {formatTokens((run.total_input_tokens ?? totalTokensFromEvents.input) + (run.total_output_tokens ?? totalTokensFromEvents.output))}
                <span style={{ color: "var(--color-text-muted)", marginLeft: 6 }}>
                  (in: {formatTokens(run.total_input_tokens ?? totalTokensFromEvents.input)}, out: {formatTokens(run.total_output_tokens ?? totalTokensFromEvents.output)})
                </span>
              </span>
              <span style={{ color: "var(--color-text-muted)" }}>Cost</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {run.cost_usd != null
                  ? formatCost(run.cost_usd)
                  : totalTokensFromEvents.total > 0
                    ? `~${formatCost(totalTokensFromEvents.input * 3 / 1_000_000 + totalTokensFromEvents.output * 15 / 1_000_000)}`
                    : "\u2014"
                }
              </span>
              {models.length > 0 && (
                <>
                  <span style={{ color: "var(--color-text-muted)" }}>{models.length === 1 ? "Model" : "Models"}</span>
                  <span style={{ fontSize: 12 }}>
                    {models.map((m) => (
                      <span key={m} style={{
                        display: "inline-block", fontSize: 10, padding: "1px 6px",
                        borderRadius: 3, background: "rgba(107,114,128,0.1)",
                        color: "var(--color-text-muted)", marginRight: 4,
                      }}>
                        {m}
                      </span>
                    ))}
                  </span>
                </>
              )}
            </div>
          </div>
        )}

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
                <ArtifactCard key={a.artifact_id} artifact={a} />
              ))}
            </div>
          </div>
        )}
        {sortedEvents.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Node Events</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sortedEvents.map((evt) => (
                <EventTimelineItem key={evt.event_id} event={evt} nodes={nodes} isLive={isActive} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ActiveDurationCell({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedTime(startedAt, true);
  return <span style={{ fontFamily: "var(--font-mono)", color: "#3b82f6" }}>{elapsed}</span>;
}

// ---------------------------------------------------------------------------
// ProcessSidekickContent (main export)
// ---------------------------------------------------------------------------

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
          <div style={{ margin: "calc(-1 * var(--space-3, 12px)) 0" }}>
            <RunPreviewBody run={previewRun} />
          </div>
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
