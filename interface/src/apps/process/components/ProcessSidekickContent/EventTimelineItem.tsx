import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@cypher-asi/zui";
import { useProcessStore } from "../../stores/process-store";
import { processApi } from "../../../../api/process";
import { formatTokensCompact as formatTokens } from "../../../../utils/format";
import { EmptyState } from "../../../../components/EmptyState";
import { ActivityTimeline } from "../../../../components/ActivityTimeline";
import type { ProcessEvent } from "../../../../types";
import type { ToolCallEntry, TimelineItem } from "../../../../types/stream";
import type { ProcessEventContentBlock } from "../../../../types";
import { useElapsedTime, formatDuration, EMPTY_RUNS, EMPTY_NODES } from "./process-sidekick-utils";

const EVENT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  completed: { bg: "rgba(16,185,129,0.15)", fg: "#10b981" },
  failed: { bg: "rgba(239,68,68,0.15)", fg: "#ef4444" },
  skipped: { bg: "rgba(107,114,128,0.15)", fg: "#6b7280" },
  running: { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
  pending: { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
};

function blocksToTimeline(blocks: ProcessEventContentBlock[]): {
  timeline: TimelineItem[];
  toolCalls: ToolCallEntry[];
  thinkingText: string;
} {
  const timeline: TimelineItem[] = [];
  const toolCalls: ToolCallEntry[] = [];
  let thinkingText = "";
  const toolMap = new Map<string, ToolCallEntry>();

  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      timeline.push({ kind: "text", content: block.text, id: `t-${timeline.length}` });
    } else if (block.type === "thinking" && block.thinking) {
      thinkingText += (thinkingText ? "\n" : "") + block.thinking;
      if (!timeline.some((t) => t.kind === "thinking")) {
        timeline.push({ kind: "thinking", id: "thinking-0" });
      }
    } else if (block.type === "tool_use" && block.name) {
      const id = block.id ?? `tool-${timeline.length}`;
      const entry: ToolCallEntry = { id, name: block.name, input: {}, pending: true };
      toolMap.set(id, entry);
      toolCalls.push(entry);
      timeline.push({ kind: "tool", toolCallId: id, id: `tool-${id}` });
    } else if (block.type === "tool_result") {
      const entry = toolMap.get(block.tool_use_id ?? "") ?? toolCalls[toolCalls.length - 1];
      if (entry) {
        entry.result = block.result ?? "";
        entry.isError = block.is_error ?? false;
        entry.pending = false;
      }
    }
  }
  return { timeline, toolCalls, thinkingText };
}

// ---------------------------------------------------------------------------
// EventTimelineItem
// ---------------------------------------------------------------------------

export interface EventTimelineItemProps {
  event: ProcessEvent;
  nodes: { node_id: string; label: string }[];
  isLive?: boolean;
}

export function EventTimelineItem({ event, nodes, isLive }: EventTimelineItemProps) {
  const isRunning = event.status === "running";
  const [expanded, setExpanded] = useState(!isRunning);

  const nodeLabel = nodes.find((n) => n.node_id === event.node_id)?.label ?? event.node_id.slice(0, 8);
  const colors = EVENT_STATUS_COLORS[event.status] ?? EVENT_STATUS_COLORS.pending;

  const hasTokens = event.input_tokens != null || event.output_tokens != null;
  const totalTokens = (event.input_tokens ?? 0) + (event.output_tokens ?? 0);
  const displayOutput = event.output;
  const hasBlocks = !isRunning && event.content_blocks && event.content_blocks.length > 0;
  const blockData = useMemo(
    () => hasBlocks ? blocksToTimeline(event.content_blocks!) : null,
    [hasBlocks, event.content_blocks],
  );

  return (
    <div
      style={{
        border: `1px solid ${isRunning ? "rgba(59,130,246,0.3)" : "var(--color-border)"}`,
        borderRadius: "var(--radius-sm)",
        fontSize: 12,
        overflow: "hidden",
        animation: isLive ? "aura-fade-in 0.3s ease-out" : undefined,
      }}
    >
      <EventTimelineItemHeader
        nodeLabel={nodeLabel}
        colors={colors}
        isRunning={isRunning}
        hasTokens={hasTokens}
        totalTokens={totalTokens}
        event={event}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      />
      {expanded && (
        <EventTimelineItemBody
          isRunning={isRunning}
          blockData={blockData}
          displayOutput={displayOutput}
          inputSnapshot={event.input_snapshot}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface HeaderProps {
  nodeLabel: string;
  colors: { bg: string; fg: string };
  isRunning: boolean;
  hasTokens: boolean;
  totalTokens: number;
  event: ProcessEvent;
  expanded: boolean;
  onToggle: () => void;
}

function EventTimelineItemHeader({
  nodeLabel, colors, isRunning, hasTokens, totalTokens, event, expanded, onToggle,
}: HeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px",
        background: "transparent", border: "none", cursor: "pointer",
        width: "100%", textAlign: "left", color: "var(--color-text)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: colors.fg,
          ...(isRunning ? { animation: "aura-pulse 1.5s ease-in-out infinite" } : {}),
        }} />
        <span style={{ flex: 1, fontWeight: 600 }}>{nodeLabel}</span>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 16, flexWrap: "wrap" }}>
        {hasTokens && (
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {formatTokens(totalTokens)} tok
          </span>
        )}
        {event.model && (
          <span style={{
            fontSize: 9, padding: "1px 5px", borderRadius: 3,
            background: "rgba(107,114,128,0.1)", color: "var(--color-text-muted)",
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
        {event.started_at && (
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {new Date(event.started_at).toLocaleString()}
            {event.completed_at && ` \u2022 ${formatDuration(event.started_at, event.completed_at)}`}
          </span>
        )}
      </div>
    </button>
  );
}

interface BodyProps {
  isRunning: boolean;
  blockData: ReturnType<typeof blocksToTimeline> | null;
  displayOutput: string | undefined;
  inputSnapshot: string | undefined;
}

function EventTimelineItemBody({ isRunning, blockData, displayOutput, inputSnapshot }: BodyProps) {
  return (
    <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
      {!isRunning && blockData && (
        <div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 2 }}>Output</div>
          <ActivityTimeline
            timeline={blockData.timeline}
            thinkingText={blockData.thinkingText}
            toolCalls={blockData.toolCalls}
            isStreaming={false}
          />
        </div>
      )}
      {!isRunning && !blockData && displayOutput && (
        <div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 2 }}>Output</div>
          <div style={{
            background: "var(--color-bg-input)", padding: 6, borderRadius: "var(--radius-sm)",
            whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 11,
            maxHeight: 200, overflow: "auto", lineHeight: 1.4,
          }}>
            {displayOutput}
          </div>
        </div>
      )}
      {inputSnapshot && (
        <div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 2 }}>Input</div>
          <div style={{
            background: "var(--color-bg-input)", padding: 6, borderRadius: "var(--radius-sm)",
            whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 11,
            maxHeight: 150, overflow: "auto", lineHeight: 1.4,
            color: "var(--color-text-muted)",
          }}>
            {inputSnapshot}
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

export function EventsTimeline({ processId }: { processId: string }) {
  const runs = useProcessStore((s) => s.runs[processId]) ?? EMPTY_RUNS;
  const nodes = useProcessStore((s) => s.nodes[processId]) ?? EMPTY_NODES;
  const setStoreEvents = useProcessStore((s) => s.setEvents);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const latestRun = runs[0];
  const cachedEvents = useProcessStore((s) => latestRun ? s.events[latestRun.run_id] : undefined);
  const [events, setEvents] = useState<ProcessEvent[]>(cachedEvents ?? []);
  const [loading, setLoading] = useState(!cachedEvents?.length);
  const isRunActive = latestRun && (latestRun.status === "running" || latestRun.status === "pending");

  const loadEvents = useCallback(async () => {
    if (!latestRun) return;
    try {
      const evts = await processApi.listRunEvents(processId, latestRun.run_id);
      setEvents(evts);
      setStoreEvents(latestRun.run_id, evts);
    } catch { /* ignore */ }
  }, [processId, latestRun?.run_id, setStoreEvents]);

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
