import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Text } from "@cypher-asi/zui";
import { useProcessStore } from "../../stores/process-store";
import { useEventStore } from "../../../../stores/event-store/index";
import { processApi } from "../../../../shared/api/process";
import { formatTokensCompact as formatTokens } from "../../../../utils/format";
import { EmptyState } from "../../../../components/EmptyState";
import type { ProcessEvent } from "../../../../shared/types";
import { useElapsedTime, formatDuration, EMPTY_RUNS, EMPTY_NODES } from "./process-sidekick-utils";
import { ProcessEventOutput } from "../ProcessEventOutput";
import { prettyPrintIfJson } from "../NodeOutputTab/node-output-utils";

const SUCCESS_COLOR = "var(--color-success, #4aeaa8)";
const SUCCESS_BACKGROUND = "color-mix(in srgb, var(--color-success, #4aeaa8) 15%, transparent)";

const EVENT_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  completed: { bg: SUCCESS_BACKGROUND, fg: SUCCESS_COLOR },
  failed: { bg: "rgba(239,68,68,0.15)", fg: "#ef4444" },
  skipped: { bg: "rgba(107,114,128,0.15)", fg: "#6b7280" },
  running: { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
  pending: { bg: "rgba(59,130,246,0.15)", fg: "#3b82f6" },
};

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
  const [expanded, setExpanded] = useState(false);
  const previousStatusRef = useRef(event.status);

  const nodeLabel = nodes.find((n) => n.node_id === event.node_id)?.label ?? event.node_id.slice(0, 8);
  const colors = EVENT_STATUS_COLORS[event.status] ?? EVENT_STATUS_COLORS.pending;

  const hasTokens = event.input_tokens != null || event.output_tokens != null;
  const totalTokens = (event.input_tokens ?? 0) + (event.output_tokens ?? 0);

  useEffect(() => {
    const wasActive = previousStatusRef.current === "running" || previousStatusRef.current === "pending";
    const isActive = event.status === "running" || event.status === "pending";
    if (wasActive && !isActive) {
      setExpanded(false);
    }
    previousStatusRef.current = event.status;
  }, [event.status]);

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
          event={event}
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
      <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
        <span style={{
          display: "flex", alignItems: "center", flexShrink: 0,
          transition: "transform 0.2s ease",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          color: "var(--color-text-muted)",
        }}>
          <ChevronRight size={12} />
        </span>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: colors.fg,
          ...(isRunning ? { animation: "aura-pulse 1.5s ease-in-out infinite" } : {}),
        }} />
        <span style={{ flex: 1, fontWeight: 600 }}>{nodeLabel}</span>
        {isRunning
          ? <NodeElapsedBadge startedAt={event.started_at} />
          : <span style={{
              fontSize: 10, padding: "1px 6px", borderRadius: 0,
              background: colors.bg, color: colors.fg, fontWeight: 600,
            }}>
              {event.status}
            </span>
        }
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 18, flexWrap: "wrap" }}>
        {event.started_at && (
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {new Date(event.started_at).toLocaleString()}
            {event.completed_at && ` \u2022 ${formatDuration(event.started_at, event.completed_at)}`}
          </span>
        )}
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
      </div>
    </button>
  );
}

interface BodyProps {
  isRunning: boolean;
  event: ProcessEvent;
  inputSnapshot: string | undefined;
}

function EventTimelineItemBody({ isRunning, event, inputSnapshot }: BodyProps) {
  const hasPersistedOutput = !!event.output?.trim() || !!event.content_blocks?.length;
  const outputPlaceholder = isRunning
    ? "Waiting for output..."
    : "No output persisted for this node.";

  return (
    <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
      <div>
        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 2 }}>Output</div>
        {hasPersistedOutput && !isRunning ? (
          <ProcessEventOutput event={event} />
        ) : (
          <div style={{
            background: "var(--color-bg-input)",
            padding: 6,
            borderRadius: "var(--radius-sm)",
            whiteSpace: "pre-wrap",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.4,
            color: "var(--color-text-muted)",
          }}>
            {outputPlaceholder}
          </div>
        )}
      </div>
      {inputSnapshot && (
        <div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 2 }}>Input</div>
          <div style={{
            background: "var(--color-bg-input)", padding: 6, borderRadius: "var(--radius-sm)",
            whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: 11,
            maxHeight: 150, overflow: "auto", lineHeight: 1.4,
            color: "var(--color-text-muted)",
          }}>
            {prettyPrintIfJson(inputSnapshot)}
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
  const connected = useEventStore((s) => s.connected);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevConnectedRef = useRef(connected);

  const latestRun = useMemo(() => (
    [...runs].sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    )[0]
  ), [runs]);
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
    if (cachedEvents) {
      setEvents(cachedEvents);
      setLoading(false);
    }
  }, [cachedEvents]);

  useEffect(() => {
    if (isRunActive) {
      intervalRef.current = setInterval(loadEvents, 4000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunActive, loadEvents]);

  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      void loadEvents();
    }
    prevConnectedRef.current = connected;
  }, [connected, loadEvents]);

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
