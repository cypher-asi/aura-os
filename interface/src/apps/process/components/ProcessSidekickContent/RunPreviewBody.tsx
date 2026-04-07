import { useCallback, useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { formatTokensCompact as formatTokens, formatCost } from "../../../../utils/format";
import { StreamingBubble } from "../../../../components/StreamingBubble";
import { MessageBubble } from "../../../../components/MessageBubble";
import { useProcessNodeStream } from "../../../../hooks/use-process-node-stream";
import { useStreamEvents, useStreamingText, useThinkingText, useThinkingDurationMs, useActiveToolCalls, useTimeline, useIsStreaming } from "../../../../hooks/stream/hooks";
import type { ProcessEvent, ProcessRun, ProcessRunTranscriptEvent } from "../../../../types";
import type { DisplaySessionEvent, TimelineItem, ToolCallEntry } from "../../../../types/stream";
import { EventTimelineItem } from "./EventTimelineItem";
import { ArtifactCard } from "./ArtifactCard";
import { LiveRunBanner } from "./LiveRunBanner";
import {
  injectKeyframes,
  useElapsedTime,
  formatDuration,
  countRunnableProcessNodes,
} from "./process-sidekick-utils";
import { buildProcessSidekickCopyText, groupTranscriptByNode, nodeTranscriptToEvents } from "./process-output-utils";
import { useRunPolling, useRunNodeTracking } from "./run-preview-hooks";

// ---------------------------------------------------------------------------
// transcriptToDisplayEvents -- replay persisted transcript into MessageBubble shape
// ---------------------------------------------------------------------------

function TranscriptReplayOutput({
  transcript,
  nodes,
}: {
  transcript: ProcessRunTranscriptEvent[];
  nodes: { node_id: string; label: string }[];
}) {
  const groups = useMemo(() => groupTranscriptByNode(transcript, nodes), [transcript, nodes]);

  const displayGroups = useMemo(
    () => groups.map((g) => ({ ...g, events: nodeTranscriptToEvents(g.entries) })),
    [groups],
  );

  const nonEmpty = displayGroups.filter((g) => g.events.length > 0);
  if (nonEmpty.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {nonEmpty.map((group) => (
        <div key={group.nodeId}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12, color: "var(--color-text-muted)" }}>
            {group.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {group.events.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CopyAllOutputButton
// ---------------------------------------------------------------------------

function CopyAllOutputButton({
  events,
  nodes,
  transcript,
  isActive,
  liveNodeLabel,
  liveState,
}: {
  events: ProcessEvent[];
  nodes: { node_id: string; label: string }[];
  transcript: ProcessRunTranscriptEvent[];
  isActive: boolean;
  liveNodeLabel?: string | null;
  liveState?: {
    events: DisplaySessionEvent[];
    streamingText: string;
    thinkingText: string;
    activeToolCalls: ToolCallEntry[];
    timeline: TimelineItem[];
  } | null;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = buildProcessSidekickCopyText({
      events,
      nodes,
      transcript,
      isActive,
      liveNodeLabel,
      liveState,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [events, isActive, liveNodeLabel, liveState, nodes, transcript]);

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

function ProcessNodeLiveOutput({
  events,
  isStreaming,
  streamingText,
  thinkingText,
  thinkingDurationMs,
  activeToolCalls,
  timeline,
}: {
  events: DisplaySessionEvent[];
  isStreaming: boolean;
  streamingText: string;
  thinkingText: string;
  thinkingDurationMs: number | null;
  activeToolCalls: ToolCallEntry[];
  timeline: TimelineItem[];
}) {
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
  run,
  isActive,
  sortedEvents,
  nodes,
  transcript,
  liveNodeLabel,
  liveState,
  totalTokensFromEvents,
  models,
}: {
  run: ProcessRun;
  isActive: boolean;
  sortedEvents: ProcessEvent[];
  nodes: { node_id: string; label: string }[];
  transcript: ProcessRunTranscriptEvent[];
  liveNodeLabel?: string | null;
  liveState?: {
    events: DisplaySessionEvent[];
    streamingText: string;
    thinkingText: string;
    activeToolCalls: ToolCallEntry[];
    timeline: TimelineItem[];
  } | null;
  totalTokensFromEvents: { input: number; output: number; total: number };
  models: string[];
}) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Run Detail</div>
        <CopyAllOutputButton
          events={sortedEvents}
          nodes={nodes}
          transcript={transcript}
          isActive={isActive}
          liveNodeLabel={liveNodeLabel}
          liveState={liveState}
        />
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
        <span style={{ color: "var(--color-text-muted)" }}>Cost</span>
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {run.cost_usd != null ? formatCost(run.cost_usd, 3) : "\u2014"}
        </span>
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
  const {
    run,
    isActive,
    nodes,
    connections,
    artifacts,
    events,
    transcript,
    loadData,
    refreshRun,
  } = useRunPolling(initialRun);
  const runningNodeIds = useRunNodeTracking(run.run_id, loadData, refreshRun);
  const runnableNodeCount = useMemo(
    () => countRunnableProcessNodes(nodes, connections),
    [nodes, connections],
  );

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
  const { streamKey: liveStreamKey } = useProcessNodeStream(
    run.run_id,
    liveRunNodeId ?? undefined,
    isActive && !!liveRunNodeId,
  );
  const liveStreamEvents = useStreamEvents(liveStreamKey);
  const liveIsStreaming = useIsStreaming(liveStreamKey);
  const liveStreamingText = useStreamingText(liveStreamKey);
  const liveThinkingText = useThinkingText(liveStreamKey);
  const liveThinkingDurationMs = useThinkingDurationMs(liveStreamKey);
  const liveActiveToolCalls = useActiveToolCalls(liveStreamKey);
  const liveTimeline = useTimeline(liveStreamKey);
  const liveCopyState = liveRunNodeId
    ? {
        events: liveStreamEvents,
        streamingText: liveStreamingText,
        thinkingText: liveThinkingText,
        activeToolCalls: liveActiveToolCalls,
        timeline: liveTimeline,
      }
    : null;

  return (
    <div style={{ fontSize: 13 }}>
      {isActive && <LiveRunBanner run={run} events={events} totalNodes={runnableNodeCount} />}
      <div style={{ padding: isActive ? 12 : "20px 12px 12px" }}>
        <RunDetailGrid
          run={run}
          isActive={isActive}
          sortedEvents={sortedEvents}
          nodes={nodes}
          transcript={transcript}
          liveNodeLabel={liveNodeLabel}
          liveState={liveCopyState}
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
        {artifacts.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Artifacts</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {artifacts.map((a) => <ArtifactCard key={a.artifact_id} artifact={a} />)}
            </div>
          </div>
        )}
        {isActive && liveRunNodeId && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Live Output &mdash; {liveNodeLabel}</div>
            <ProcessNodeLiveOutput
              events={liveStreamEvents}
              isStreaming={liveIsStreaming}
              streamingText={liveStreamingText}
              thinkingText={liveThinkingText}
              thinkingDurationMs={liveThinkingDurationMs}
              activeToolCalls={liveActiveToolCalls}
              timeline={liveTimeline}
            />
          </div>
        )}
        {!isActive && transcript.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Run Output</div>
            <TranscriptReplayOutput transcript={transcript} nodes={nodes} />
          </div>
        )}
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
