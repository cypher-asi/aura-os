import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { useEventStore } from "../../../../stores/event-store";
import { EventType } from "../../../../types/aura-events";
import { processApi } from "../../../../api/process";
import { formatTokensCompact as formatTokens, formatCost } from "../../../../utils/format";
import { StreamingBubble } from "../../../../components/StreamingBubble";
import { MessageBubble } from "../../../../components/MessageBubble";
import { useProcessNodeStream } from "../../../../hooks/use-process-node-stream";
import { useStreamEvents, useStreamingText, useThinkingText, useThinkingDurationMs, useActiveToolCalls, useTimeline, useIsStreaming } from "../../../../hooks/stream/hooks";
import type { ProcessArtifact, ProcessEvent, ProcessRun } from "../../../../types";
import { EventTimelineItem } from "./EventTimelineItem";
import { ArtifactCard } from "./ArtifactCard";
import { LiveRunBanner } from "./LiveRunBanner";
import { injectKeyframes, useElapsedTime, formatDuration, EMPTY_NODES } from "./process-sidekick-utils";

// ---------------------------------------------------------------------------
// useRunPreviewData -- encapsulates all data-fetching / polling / SSE logic
// ---------------------------------------------------------------------------

function useRunPolling(initialRun: ProcessRun) {
  const [run, setRun] = useState(initialRun);
  const nodes = useProcessStore((s) => s.nodes[run.process_id]) ?? EMPTY_NODES;
  const fetchRuns = useProcessStore((s) => s.fetchRuns);
  const setStoreEvents = useProcessStore((s) => s.setEvents);
  const cachedEvents = useProcessStore((s) => s.events[run.run_id]);
  const [artifacts, setArtifacts] = useState<ProcessArtifact[]>([]);
  const [events, setEvents] = useState<ProcessEvent[]>(cachedEvents ?? []);
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
      setStoreEvents(run.run_id, evtList);
    } catch { /* ignore */ }
  }, [run.process_id, run.run_id, setStoreEvents]);

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

  return { run, isActive, nodes, artifacts, events, loadData, refreshRun };
}

function useRunNodeTracking(
  runId: string,
  loadData: () => Promise<void>,
  refreshRun: () => Promise<void>,
) {
  const nodeStatuses = useProcessSidekickStore((s) => s.nodeStatuses);
  const [runningNodeIds, setRunningNodeIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      if (status === "running") initial.add(nodeId);
    }
    return initial;
  });

  useEffect(() => {
    const next = new Set<string>();
    for (const [nodeId, status] of Object.entries(nodeStatuses)) {
      if (status === "running") next.add(nodeId);
    }
    if (next.size > 0) {
      setRunningNodeIds((prev) => {
        const merged = new Set(prev);
        for (const id of next) merged.add(id);
        return merged;
      });
    }
  }, [nodeStatuses]);

  useEffect(() => {
    const unsub1 = useEventStore.getState().subscribe(EventType.ProcessNodeExecuted, (event) => {
      if (event.content.run_id === runId) {
        const status = event.content.status.toLowerCase();
        if (status.includes("running")) {
          setRunningNodeIds((prev) => new Set(prev).add(event.content.node_id));
        } else {
          setRunningNodeIds((prev) => {
            const next = new Set(prev);
            next.delete(event.content.node_id);
            return next;
          });
        }
        loadData();
      }
    });
    const handleComplete = (event: { content: { run_id: string } }) => {
      if (event.content.run_id === runId) {
        setRunningNodeIds(new Set());
        refreshRun();
        loadData();
      }
    };
    const unsub2 = useEventStore.getState().subscribe(EventType.ProcessRunCompleted, handleComplete);
    const unsub3 = useEventStore.getState().subscribe(EventType.ProcessRunFailed, handleComplete);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [runId, loadData, refreshRun]);

  return runningNodeIds;
}

// ---------------------------------------------------------------------------
// buildFullRunOutput
// ---------------------------------------------------------------------------

function buildFullRunOutput(
  events: ProcessEvent[],
  nodes: { node_id: string; label: string }[],
): string {
  const parts: string[] = [];
  for (const evt of events) {
    if (evt.status === "running" || evt.status === "pending") continue;
    const label = nodes.find((n) => n.node_id === evt.node_id)?.label ?? evt.node_id;
    parts.push(`## ${label} [${evt.status}]`);

    if (evt.content_blocks && evt.content_blocks.length > 0) {
      for (const block of evt.content_blocks) {
        const b = block as unknown as Record<string, unknown>;
        if (b.type === "text" && b.text) parts.push(b.text as string);
        else if (b.type === "thinking" && b.thinking) parts.push(`<thinking>\n${b.thinking as string}\n</thinking>`);
        else if (b.type === "tool_use") parts.push(`[tool_call: ${b.name as string}]`);
        else if (b.type === "tool_result") {
          const errTag = b.is_error ? " (error)" : "";
          parts.push(`[tool_result: ${b.name as string}${errTag}]\n${(b.result as string) ?? ""}`);
        }
      }
    } else if (evt.output) {
      parts.push(evt.output);
    }

    if (evt.input_snapshot) {
      parts.push(`\n--- Input ---\n${evt.input_snapshot}`);
    }
    parts.push("");
  }
  return parts.join("\n").trim();
}

// ---------------------------------------------------------------------------
// CopyAllOutputButton
// ---------------------------------------------------------------------------

function CopyAllOutputButton({ events, nodes }: { events: ProcessEvent[]; nodes: { node_id: string; label: string }[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = buildFullRunOutput(events, nodes);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [events, nodes]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy all output"
      style={{
        display: "flex", alignItems: "center", gap: 4,
        background: "transparent", border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)", padding: "2px 8px",
        cursor: "pointer", fontSize: 10, color: "var(--color-text-muted)",
      }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? "Copied" : "Copy All"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ProcessNodeLiveOutput
// ---------------------------------------------------------------------------

function ProcessNodeLiveOutput({ runId, nodeId, isActive }: { runId: string; nodeId: string; isActive: boolean }) {
  const { streamKey } = useProcessNodeStream(runId, nodeId, isActive);
  const events = useStreamEvents(streamKey);
  const isStreaming = useIsStreaming(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const thinkingDurationMs = useThinkingDurationMs(streamKey);
  const activeToolCalls = useActiveToolCalls(streamKey);
  const timeline = useTimeline(streamKey);

  const hasLive = isStreaming || streamingText || thinkingText || activeToolCalls.length > 0 || timeline.length > 0;
  const hasContent = hasLive || events.length > 0;

  if (!hasContent) {
    return (
      <div style={{ fontSize: 11, color: "#3b82f6", fontStyle: "italic", padding: "4px 0" }}>
        Waiting for output...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {events.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {hasLive && (
        <StreamingBubble
          isStreaming={isStreaming}
          text={streamingText}
          toolCalls={activeToolCalls}
          thinkingText={thinkingText}
          thinkingDurationMs={thinkingDurationMs}
          timeline={timeline}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActiveDurationCell
// ---------------------------------------------------------------------------

function ActiveDurationCell({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsedTime(startedAt, true);
  return <span style={{ fontFamily: "var(--font-mono)", color: "#3b82f6" }}>{elapsed}</span>;
}

// ---------------------------------------------------------------------------
// RunDetailGrid -- the metadata grid inside RunPreviewBody
// ---------------------------------------------------------------------------

function RunDetailGrid({
  run, isActive, sortedEvents, nodes, totalTokensFromEvents, models,
}: {
  run: ProcessRun;
  isActive: boolean;
  sortedEvents: ProcessEvent[];
  nodes: { node_id: string; label: string }[];
  totalTokensFromEvents: { input: number; output: number; total: number };
  models: string[];
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Run Detail</div>
        <CopyAllOutputButton events={sortedEvents} nodes={nodes} />
      </div>
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

      <RunTokensSection
        run={run}
        totalTokensFromEvents={totalTokensFromEvents}
        models={models}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// RunTokensSection
// ---------------------------------------------------------------------------

function RunTokensSection({
  run, totalTokensFromEvents, models,
}: {
  run: ProcessRun;
  totalTokensFromEvents: { input: number; output: number; total: number };
  models: string[];
}) {
  if (run.total_input_tokens == null && run.total_output_tokens == null && totalTokensFromEvents.total === 0) {
    return null;
  }
  return (
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
            ? formatCost(run.cost_usd, 3)
            : totalTokensFromEvents.total > 0
              ? `~${formatCost(totalTokensFromEvents.input * 3 / 1_000_000 + totalTokensFromEvents.output * 15 / 1_000_000, 3)}`
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
  );
}

// ---------------------------------------------------------------------------
// RunPreviewBody (main export)
// ---------------------------------------------------------------------------

export function RunPreviewBody({ run: initialRun }: { run: ProcessRun }) {
  injectKeyframes();
  const { run, isActive, nodes, artifacts, events, loadData, refreshRun } = useRunPolling(initialRun);
  const runningNodeIds = useRunNodeTracking(run.run_id, loadData, refreshRun);

  const sortedEvents = useMemo(() => {
    const sorted = [...events].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    for (const nodeId of runningNodeIds) {
      if (!sorted.some((e) => e.node_id === nodeId)) {
        sorted.push({
          event_id: `live-${nodeId}`,
          run_id: run.run_id,
          node_id: nodeId,
          process_id: run.process_id,
          status: "running" as ProcessEvent["status"],
          input_snapshot: "",
          output: "",
          started_at: new Date().toISOString(),
          completed_at: null,
        });
      }
    }
    return sorted;
  }, [events, runningNodeIds, run.run_id, run.process_id]);

  const models = useMemo(() => {
    const set = new Set<string>();
    for (const evt of events) { if (evt.model) set.add(evt.model); }
    return [...set];
  }, [events]);

  const totalTokensFromEvents = useMemo(() => {
    let input = 0, output = 0;
    for (const evt of events) { input += evt.input_tokens ?? 0; output += evt.output_tokens ?? 0; }
    return { input, output, total: input + output };
  }, [events]);

  const liveRunNodeId = useProcessSidekickStore((s) => s.liveRunNodeId);
  const liveNodeLabel = liveRunNodeId
    ? nodes.find((n) => n.node_id === liveRunNodeId)?.label ?? "Node"
    : null;

  return (
    <div style={{ fontSize: 13 }}>
      {isActive && <LiveRunBanner run={run} events={events} totalNodes={nodes.length} />}
      <div style={{ padding: 12 }}>
        <RunDetailGrid
          run={run}
          isActive={isActive}
          sortedEvents={sortedEvents}
          nodes={nodes}
          totalTokensFromEvents={totalTokensFromEvents}
          models={models}
        />

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
        {isActive && liveRunNodeId && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Live Output &mdash; {liveNodeLabel}</div>
            <ProcessNodeLiveOutput runId={run.run_id} nodeId={liveRunNodeId} isActive />
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
              {artifacts.map((a) => <ArtifactCard key={a.artifact_id} artifact={a} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
