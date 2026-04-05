import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { Pin, PinOff, ChevronDown, ChevronUp } from "lucide-react";
import type { ProcessNode, ProcessEvent, ProcessEventContentBlock, ProcessArtifact, ProcessRun } from "../../../types";
import type { ToolCallEntry, TimelineItem } from "../../../types/stream";
import { processApi } from "../../../api/process";
import { useProcessStore } from "../stores/process-store";
import { useProcessSidekickStore } from "../stores/process-sidekick-store";
import { ActivityTimeline } from "../../../components/ActivityTimeline";
import styles from "../../../components/Preview/Preview.module.css";

interface NodeOutputTabProps {
  node: ProcessNode;
}

const POLL_INTERVAL = 4000;
const EMPTY_RUNS: ProcessRun[] = [];

const monoBox: React.CSSProperties = {
  background: "var(--color-bg-input)",
  padding: 8,
  borderRadius: "var(--radius-sm)",
  whiteSpace: "pre-wrap",
  fontSize: 12,
  fontFamily: "var(--font-mono)",
  maxHeight: 400,
  overflow: "auto",
  lineHeight: 1.5,
  color: "var(--color-text)",
};

function contentBlocksToTimeline(blocks: ProcessEventContentBlock[]): {
  timeline: TimelineItem[];
  toolCalls: ToolCallEntry[];
  thinkingText: string;
} {
  const timeline: TimelineItem[] = [];
  const toolCalls: ToolCallEntry[] = [];
  let thinkingText = "";
  const toolCallMap = new Map<string, ToolCallEntry>();

  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      timeline.push({ kind: "text", content: block.text, id: `text-${timeline.length}` });
    } else if (block.type === "thinking" && block.thinking) {
      thinkingText += (thinkingText ? "\n" : "") + block.thinking;
      if (!timeline.some((t) => t.kind === "thinking")) {
        timeline.push({ kind: "thinking", id: "thinking-0" });
      }
    } else if (block.type === "tool_use" && block.name) {
      const id = block.id ?? `tool-${timeline.length}`;
      const entry: ToolCallEntry = {
        id,
        name: block.name,
        input: {},
        pending: true,
      };
      toolCallMap.set(id, entry);
      toolCalls.push(entry);
      timeline.push({ kind: "tool", toolCallId: id, id: `tool-${id}` });
    } else if (block.type === "tool_result") {
      const matchId = block.tool_use_id ?? "";
      const entry = toolCallMap.get(matchId) ?? toolCalls[toolCalls.length - 1];
      if (entry) {
        entry.result = block.result ?? "";
        entry.isError = block.is_error ?? false;
        entry.pending = false;
      }
    }
  }

  return { timeline, toolCalls, thinkingText };
}

const PIN_TRUNCATE = 400;

function PinnedOutputField({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > PIN_TRUNCATE;
  const display = !expanded && needsTruncation ? text.slice(0, PIN_TRUNCATE) + "…" : text;

  return (
    <div className={styles.taskField}>
      <span className={styles.fieldLabel} style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Pin size={11} style={{ color: "#f59e0b" }} />
        Pinned Output
        <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontWeight: 400 }}>
          — this is what downstream nodes receive
        </span>
      </span>
      <div
        style={{
          ...monoBox,
          maxHeight: expanded ? "none" : 200,
          borderLeft: "2px solid #f59e0b40",
        }}
      >
        {display}
      </div>
      {needsTruncation && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "none",
            border: "none",
            padding: 0,
            marginTop: 4,
            fontSize: 11,
            color: "var(--color-text-link, #3b82f6)",
            cursor: "pointer",
          }}
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {expanded ? "Show less" : `Show more (${(text.length / 1024).toFixed(1)} KB)`}
        </button>
      )}
    </div>
  );
}

function PinOutputButton({ node, output }: { node: ProcessNode; output: string }) {
  const { processId } = useParams<{ processId: string }>();
  const fetchNodes = useProcessStore((s) => s.fetchNodes);
  const isPinned = !!node.config?.pinned_output;
  const [busy, setBusy] = useState(false);

  const handleToggle = useCallback(async () => {
    if (!processId || busy) return;
    setBusy(true);
    try {
      const newConfig = { ...node.config };
      if (isPinned) {
        delete newConfig.pinned_output;
      } else {
        newConfig.pinned_output = output;
      }
      await processApi.updateNode(processId, node.node_id, { config: newConfig });
      await fetchNodes(processId);
    } finally {
      setBusy(false);
    }
  }, [processId, node, output, isPinned, busy, fetchNodes]);

  return (
    <button
      onClick={handleToggle}
      disabled={busy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 600,
        border: isPinned ? "1px solid #f59e0b40" : "1px solid var(--color-border)",
        borderRadius: 0,
        background: isPinned ? "rgba(245,158,11,0.1)" : "transparent",
        color: isPinned ? "#f59e0b" : "var(--color-text-muted)",
        cursor: busy ? "wait" : "pointer",
        transition: "all 0.15s",
      }}
    >
      {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
      {isPinned ? "Unpin Output" : "Pin Output"}
    </button>
  );
}

export function NodeOutputTab({ node }: NodeOutputTabProps) {
  const { processId } = useParams<{ processId: string }>();
  const runs = useProcessStore((s) => (processId ? s.runs[processId] : undefined)) ?? EMPTY_RUNS;
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const latestRun = runs[0];
  const isRunActive = latestRun && (latestRun.status === "running" || latestRun.status === "pending");

  const loadEvents = useCallback(async () => {
    if (!processId || !latestRun) return;
    try {
      const evts = await processApi.listRunEvents(processId, latestRun.run_id);
      setEvents(evts);
    } catch { /* ignore */ }
  }, [processId, latestRun?.run_id]);

  const loadArtifacts = useCallback(async () => {
    if (!processId || !latestRun) return;
    if (node.node_type !== "artifact") return;
    try {
      const list = await processApi.listRunArtifacts(processId, latestRun.run_id);
      setArtifacts(list.filter((a) => a.node_id === node.node_id));
    } catch { /* ignore */ }
  }, [processId, latestRun?.run_id, node.node_id, node.node_type]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadEvents(), loadArtifacts()]).finally(() => setLoading(false));
  }, [loadEvents, loadArtifacts]);

  useEffect(() => {
    if (isRunActive) {
      intervalRef.current = setInterval(() => {
        loadEvents();
        loadArtifacts();
      }, POLL_INTERVAL);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunActive, loadEvents, loadArtifacts]);

  const currentNodeStatus = nodeStatuses[node.node_id];
  useEffect(() => {
    if (currentNodeStatus) {
      loadEvents();
      loadArtifacts();
    }
  }, [currentNodeStatus, loadEvents, loadArtifacts]);

  const nodeEvent = events.find((e) => e.node_id === node.node_id);
  const hasBlocks = nodeEvent?.content_blocks && nodeEvent.content_blocks.length > 0;

  const { timeline, toolCalls, thinkingText } = useMemo(
    () => hasBlocks ? contentBlocksToTimeline(nodeEvent!.content_blocks!) : { timeline: [], toolCalls: [], thinkingText: "" },
    [hasBlocks, nodeEvent?.content_blocks],
  );

  const pinnedOutput = node.config?.pinned_output as string | undefined;

  return (
    <div className={styles.previewBody}>
      <div className={styles.taskMeta}>
        {pinnedOutput && (
          <PinnedOutputField text={pinnedOutput} />
        )}

        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Run</span>
          <Text variant="secondary" size="sm">
            {latestRun
              ? `${latestRun.trigger} · ${latestRun.status} · ${new Date(latestRun.started_at).toLocaleString()}`
              : "No runs yet"}
          </Text>
        </div>

        {loading && (
          <Text variant="secondary" size="sm" style={{ padding: 8 }}>
            Loading...
          </Text>
        )}

        {!loading && nodeEvent && (
          <>
            <div className={styles.taskField}>
              <span className={styles.fieldLabel}>Status</span>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 0,
                  background:
                    nodeEvent.status === "completed"
                      ? "rgba(16,185,129,0.15)"
                      : nodeEvent.status === "failed"
                        ? "rgba(239,68,68,0.15)"
                        : nodeEvent.status === "skipped"
                          ? "rgba(107,114,128,0.15)"
                          : "rgba(59,130,246,0.15)",
                  color:
                    nodeEvent.status === "completed"
                      ? "#10b981"
                      : nodeEvent.status === "failed"
                        ? "#ef4444"
                        : nodeEvent.status === "skipped"
                          ? "#6b7280"
                          : "#3b82f6",
                  fontWeight: 600,
                }}
              >
                {nodeEvent.status}
              </span>
            </div>

            {nodeEvent.status === "completed" && nodeEvent.output && (
              <div className={styles.taskField}>
                <PinOutputButton node={node} output={nodeEvent.output} />
              </div>
            )}

            {hasBlocks ? (
              <div className={styles.taskField}>
                <span className={styles.fieldLabel}>Conversation</span>
                <ActivityTimeline
                  timeline={timeline}
                  thinkingText={thinkingText}
                  toolCalls={toolCalls}
                  isStreaming={false}
                />
              </div>
            ) : nodeEvent.output ? (
              <div className={styles.taskField}>
                <span className={styles.fieldLabel}>Output</span>
                <div style={monoBox}>{nodeEvent.output}</div>
              </div>
            ) : null}

            {nodeEvent.input_snapshot && (
              <div className={styles.taskField}>
                <span className={styles.fieldLabel}>Input</span>
                <div
                  style={{
                    ...monoBox,
                    maxHeight: 200,
                    color: "var(--color-text-muted)",
                  }}
                >
                  {nodeEvent.input_snapshot}
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !nodeEvent && isRunActive && currentNodeStatus === undefined && (
          <Text variant="secondary" size="sm" style={{ padding: 8 }}>
            Waiting for this node to execute...
          </Text>
        )}

        {!loading && !nodeEvent && !isRunActive && latestRun && (
          <Text variant="secondary" size="sm" style={{ padding: 8 }}>
            No output for this node in the latest run
          </Text>
        )}

        {artifacts.length > 0 && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Artifacts</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {artifacts.map((a) => (
                <div
                  key={a.artifact_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 12,
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
                      background: "transparent",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontSize: 11,
                      color: "var(--color-text)",
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
    </div>
  );
}
