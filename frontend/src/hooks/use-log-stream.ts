import React, { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import { useEventStore } from "../stores/event-store";
import type { AuraEvent, AuraEventContent } from "../types/aura-events";
import { EventType } from "../types/aura-events";
import { formatTime } from "../utils/format";
import { LOG_MAX_LINES } from "../constants";
import { api } from "../api/client";
import { formatCost } from "../utils/format";

export interface LogEntry {
  timestamp: string;
  type: EventType;
  summary: string;
  detail: AuraEvent;
}

const EVENT_LABELS: Record<EventType, string> = {
  [EventType.UserMessage]: "Message",
  [EventType.MessageStart]: "Message",
  [EventType.MessageEnd]: "Message",
  [EventType.Delta]: "Message",
  [EventType.ThinkingDelta]: "Message",
  [EventType.Progress]: "Message",
  [EventType.ToolCallStarted]: "Tool",
  [EventType.ToolCallSnapshot]: "Tool",
  [EventType.ToolCall]: "Tool",
  [EventType.ToolResult]: "Tool",
  [EventType.TokenUsage]: "Token",
  [EventType.Done]: "Message",
  [EventType.AgentInstanceUpdated]: "Agent",
  [EventType.RemoteAgentStateChanged]: "Agent",
  [EventType.SpecSaved]: "Spec",
  [EventType.SpecsTitle]: "Spec",
  [EventType.SpecsSummary]: "Spec",
  [EventType.SpecGenStarted]: "Spec",
  [EventType.SpecGenProgress]: "Spec",
  [EventType.SpecGenCompleted]: "Spec",
  [EventType.SpecGenFailed]: "Spec",
  [EventType.SpecGenerating]: "Spec",
  [EventType.SpecGenComplete]: "Spec",
  [EventType.TaskSaved]: "Task",
  [EventType.TaskStarted]: "Task",
  [EventType.TaskCompleted]: "Task",
  [EventType.TaskFailed]: "Task",
  [EventType.TaskRetrying]: "Task",
  [EventType.TaskBecameReady]: "Task",
  [EventType.TasksBecameReady]: "Task",
  [EventType.FollowUpTaskCreated]: "Task",
  [EventType.FileOpsApplied]: "Files",
  [EventType.LoopStarted]: "Loop",
  [EventType.LoopPaused]: "Loop",
  [EventType.LoopResumed]: "Loop",
  [EventType.LoopStopped]: "Loop",
  [EventType.LoopFinished]: "Loop",
  [EventType.LoopIterationSummary]: "Loop",
  [EventType.SessionRolledOver]: "Session",
  [EventType.BuildVerificationSkipped]: "Build",
  [EventType.BuildVerificationStarted]: "Build",
  [EventType.BuildVerificationPassed]: "Build",
  [EventType.BuildVerificationFailed]: "Build",
  [EventType.BuildFixAttempt]: "Build",
  [EventType.TestVerificationStarted]: "Test",
  [EventType.TestVerificationPassed]: "Test",
  [EventType.TestVerificationFailed]: "Test",
  [EventType.TestFixAttempt]: "Test",
  [EventType.GitCommitted]: "Git",
  [EventType.GitPushed]: "Git",
  [EventType.LogLine]: "Log",
  [EventType.NetworkEvent]: "Network",
  [EventType.Error]: "Error",
  [EventType.SessionReady]: "Session",
  [EventType.AssistantMessageStart]: "Message",
  [EventType.AssistantMessageEnd]: "Message",
  [EventType.TextDelta]: "Message",
  [EventType.ToolUseStart]: "Tool",
};

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function summariseLoopEvent(e: AuraEvent): string {
  switch (e.type) {
    case EventType.LoopStarted:
      return "Dev loop started";
    case EventType.LoopPaused:
      return `Loop paused (${e.content.completed_count ?? 0} completed)`;
    case EventType.LoopStopped:
      return `Loop stopped (${e.content.completed_count ?? 0} completed)`;
    case EventType.LoopFinished: {
      const c = e.content;
      const parts = [`Loop finished: ${c.outcome ?? "unknown"}`];
      if (c.tasks_completed != null) {
        const dur = c.total_duration_ms != null ? ` in ${fmtDuration(c.total_duration_ms)}` : "";
        parts[0] = `Loop finished: ${c.tasks_completed} tasks${dur}`;
      }
      if (c.total_input_tokens != null && c.total_output_tokens != null) {
        const tokens = fmtTokens(c.total_input_tokens + c.total_output_tokens);
        if (c.total_cost_usd != null) {
          parts.push(`${tokens} tokens, ${formatCost(c.total_cost_usd)}`);
        } else {
          parts.push(`${tokens} tokens`);
        }
      }
      if (c.tasks_retried) parts.push(`${c.tasks_retried} retries`);
      if (c.sessions_used && c.sessions_used > 1) parts.push(`${c.sessions_used} sessions`);
      if (c.total_build_fix_attempts) parts.push(`${c.total_build_fix_attempts} build fixes`);
      if (c.total_parse_retries) parts.push(`${c.total_parse_retries} parse retries`);
      return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(", ")})` : parts[0];
    }
    case EventType.LoopIterationSummary: {
      const c = e.content;
      if (!c.phase_timings || c.phase_timings.length === 0) return `Task breakdown: ${c.task_id}`;
      const breakdown = c.phase_timings
        .map((p) => `${p.phase} ${fmtDuration(p.duration_ms)}`)
        .join(", ");
      return `Task breakdown: ${breakdown}`;
    }
    default:
      return e.type;
  }
}

function summariseTaskCompleted(c: AuraEventContent<EventType.TaskCompleted>): string {
  const name = c.task_title || c.task_id;
  const parts: string[] = [];
  if (c.duration_ms != null) parts.push(fmtDuration(c.duration_ms));
  if (c.input_tokens != null && c.output_tokens != null) {
    parts.push(`${fmtTokens(c.input_tokens + c.output_tokens)} tokens`);
    if (c.cost_usd != null) {
      parts.push(formatCost(c.cost_usd));
    }
  }
  if (c.parse_retries) parts.push(`${c.parse_retries} retries`);
  if (c.build_fix_attempts) parts.push(`${c.build_fix_attempts} build fix${c.build_fix_attempts > 1 ? "es" : ""}`);
  return parts.length > 0 ? `Completed: ${name} (${parts.join(", ")})` : `Completed: ${name}`;
}

function summariseTaskEvent(e: AuraEvent): string {
  switch (e.type) {
    case EventType.TaskStarted: {
      const c = e.content;
      const name = c.task_title || c.task_id;
      if (c.codebase_snapshot_bytes != null) {
        const kb = (c.codebase_snapshot_bytes / 1024).toFixed(0);
        return `Started: ${name} (snapshot: ${kb}KB, ${c.codebase_file_count ?? "?"} files)`;
      }
      return `Started: ${name}`;
    }
    case EventType.TaskCompleted:
      return summariseTaskCompleted(e.content);
    case EventType.TaskFailed: {
      const c = e.content;
      const name = c.task_title || c.task_id;
      const parts: string[] = [];
      if (c.duration_ms != null) parts.push(fmtDuration(c.duration_ms));
      if (c.phase) parts.push(`phase: ${c.phase}`);
      if (c.build_fix_attempts) parts.push(`${c.build_fix_attempts} fix attempts`);
      return `Failed: ${name}${parts.length > 0 ? ` (${parts.join(", ")})` : ""} — ${c.reason || "unknown"}`;
    }
    case EventType.TaskRetrying:
      return `Retrying: ${e.content.task_id} (attempt ${e.content.attempt ?? "?"})`;
    case EventType.TaskBecameReady:
      return `Task ready: ${e.content.task_id}`;
    case EventType.TasksBecameReady:
      return `Tasks ready: ${(e.content.task_ids ?? []).length} task(s)`;
    case EventType.FileOpsApplied:
      return `Files: ${e.content.files_written ?? 0} written, ${e.content.files_deleted ?? 0} deleted`;
    case EventType.FollowUpTaskCreated:
      return `Follow-up created: ${e.content.task_id}`;
    default:
      return e.type;
  }
}

function summariseSessionEvent(e: AuraEvent): string {
  switch (e.type) {
    case EventType.SessionRolledOver: {
      const c = e.content;
      const parts: string[] = [];
      if (c.summary_duration_ms != null) parts.push(`summary took ${fmtDuration(c.summary_duration_ms)}`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return `Context rotated${detail} → Session ${c.new_session_id?.slice(0, 8)}`;
    }
    case EventType.LogLine:
      return e.content.message || "";
    default:
      return e.type;
  }
}

function summariseSpecEvent(e: AuraEvent): string {
  switch (e.type) {
    case EventType.SpecGenStarted:
      return "Spec generation started";
    case EventType.SpecGenProgress:
      return `Spec generation: ${e.content.stage ?? ""}`;
    case EventType.SpecGenCompleted:
      return `Spec generation completed (${e.content.spec_count ?? 0} specs)`;
    case EventType.SpecGenFailed:
      return `Spec generation failed: ${e.content.reason ?? "unknown"}`;
    case EventType.SpecSaved:
      return `Spec saved: ${e.content.spec?.title ?? e.project_id}`;
    default:
      return e.type;
  }
}

function summariseBuildEvent(e: AuraEvent): string {
  const c = e.content as Record<string, unknown>;
  switch (e.type) {
    case EventType.BuildVerificationSkipped:
      return `Build verification skipped${c.reason ? `: ${c.reason}` : ""}`;
    case EventType.BuildVerificationStarted:
      return `Build verification started${c.task_id ? `: ${c.task_id}` : ""}`;
    case EventType.BuildVerificationPassed: {
      const dur = c.duration_ms != null ? ` (${fmtDuration(c.duration_ms as number)})` : "";
      return `Build passed${dur}`;
    }
    case EventType.BuildVerificationFailed: {
      const parts: string[] = [];
      if (c.duration_ms != null) parts.push(fmtDuration(c.duration_ms as number));
      if (c.attempt != null) parts.push(`attempt ${c.attempt}`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return `Build failed${detail}`;
    }
    case EventType.BuildFixAttempt:
      return `Build fix attempt${c.attempt ? ` #${c.attempt}` : ""}`;
    default:
      return e.type;
  }
}

function summariseTestEvent(e: AuraEvent): string {
  const c = e.content as Record<string, unknown>;
  switch (e.type) {
    case EventType.TestVerificationStarted:
      return `Test verification started${c.task_id ? `: ${c.task_id}` : ""}`;
    case EventType.TestVerificationPassed: {
      const dur = c.duration_ms != null ? ` (${fmtDuration(c.duration_ms as number)})` : "";
      return `Test passed${dur}`;
    }
    case EventType.TestVerificationFailed: {
      const parts: string[] = [];
      if (c.duration_ms != null) parts.push(fmtDuration(c.duration_ms as number));
      if (c.attempt != null) parts.push(`attempt ${c.attempt}`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return `Test failed${detail}`;
    }
    case EventType.TestFixAttempt:
      return `Test fix attempt${c.attempt ? ` #${c.attempt}` : ""}`;
    default:
      return e.type;
  }
}

function summarise(e: AuraEvent): string {
  switch (e.type) {
    case EventType.LoopStarted:
    case EventType.LoopPaused:
    case EventType.LoopStopped:
    case EventType.LoopFinished:
    case EventType.LoopIterationSummary:
      return summariseLoopEvent(e);
    case EventType.TaskStarted:
    case EventType.TaskCompleted:
    case EventType.TaskFailed:
    case EventType.TaskRetrying:
    case EventType.TaskBecameReady:
    case EventType.TasksBecameReady:
    case EventType.FileOpsApplied:
    case EventType.FollowUpTaskCreated:
      return summariseTaskEvent(e);
    case EventType.SessionRolledOver:
    case EventType.LogLine:
      return summariseSessionEvent(e);
    case EventType.SpecGenStarted:
    case EventType.SpecGenProgress:
    case EventType.SpecGenCompleted:
    case EventType.SpecGenFailed:
    case EventType.SpecSaved:
      return summariseSpecEvent(e);
    case EventType.BuildVerificationSkipped:
    case EventType.BuildVerificationStarted:
    case EventType.BuildVerificationPassed:
    case EventType.BuildVerificationFailed:
    case EventType.BuildFixAttempt:
      return summariseBuildEvent(e);
    case EventType.TestVerificationStarted:
    case EventType.TestVerificationPassed:
    case EventType.TestVerificationFailed:
    case EventType.TestFixAttempt:
      return summariseTestEvent(e);
    case EventType.GitCommitted: {
      const c = e.content;
      return `Git commit: ${c.commit_sha?.slice(0, 8) ?? c.task_id ?? ""}`;
    }
    case EventType.GitPushed: {
      const c = e.content;
      return `Git push: ${c.branch ?? c.task_id ?? ""}`;
    }
    case EventType.NetworkEvent:
      return `Network: ${e.content.network_event_type ?? "event"}`;
    case EventType.Error:
      return `Error: ${e.content.message}`;
    default:
      return e.type;
  }
}

export { EVENT_LABELS };

interface UseLogStreamResult {
  entries: LogEntry[];
  contentRef: RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  connected: boolean;
}

const ALL_ENGINE_EVENT_TYPES: EventType[] = [
  EventType.LoopStarted, EventType.LoopPaused, EventType.LoopStopped,
  EventType.LoopFinished, EventType.LoopIterationSummary,
  EventType.TaskStarted, EventType.TaskCompleted, EventType.TaskFailed,
  EventType.TaskRetrying, EventType.TaskBecameReady, EventType.TasksBecameReady,
  EventType.FileOpsApplied, EventType.FollowUpTaskCreated,
  EventType.SessionRolledOver, EventType.LogLine,
  EventType.SpecGenStarted, EventType.SpecGenProgress,
  EventType.SpecGenCompleted, EventType.SpecGenFailed, EventType.SpecSaved,
  EventType.BuildVerificationSkipped, EventType.BuildVerificationStarted,
  EventType.BuildVerificationPassed, EventType.BuildVerificationFailed,
  EventType.BuildFixAttempt,
  EventType.TestVerificationStarted, EventType.TestVerificationPassed,
  EventType.TestVerificationFailed, EventType.TestFixAttempt,
  EventType.GitCommitted, EventType.GitPushed, EventType.NetworkEvent,
];

function eventToLogEntry(event: AuraEvent, ts?: Date): LogEntry {
  return {
    timestamp: formatTime(ts ?? new Date()),
    type: event.type,
    summary: summarise(event),
    detail: event,
  };
}

function mergeEntries(restored: LogEntry[], prev: LogEntry[]): LogEntry[] {
  const combined = [...restored, ...prev];
  return combined.length > LOG_MAX_LINES ? combined.slice(-LOG_MAX_LINES) : combined;
}

function useLogHistory(setEntries: React.Dispatch<React.SetStateAction<LogEntry[]>>): void {
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    api.getLogEntries(LOG_MAX_LINES).then((persisted) => {
      if (persisted.length === 0) return;
      const restored = persisted.map((p) => eventToLogEntry(p.event as unknown as AuraEvent, new Date(p.timestamp_ms)));
      setEntries((prev) => mergeEntries(restored, prev));
    }).catch(() => {});

    return () => { historyLoadedRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function useLogSubscription(
  setEntries: React.Dispatch<React.SetStateAction<LogEntry[]>>,
): void {
  const subscribe = useEventStore((s) => s.subscribe);

  const addEntry = useCallback((event: AuraEvent) => {
    setEntries((prev) => {
      const next = [...prev, eventToLogEntry(event)];
      return next.length > LOG_MAX_LINES ? next.slice(-LOG_MAX_LINES) : next;
    });
  }, [setEntries]);

  useEffect(() => {
    const unsubs = ALL_ENGINE_EVENT_TYPES.map((type) => subscribe(type, (e) => addEntry(e)));
    return () => unsubs.forEach((u) => u());
  }, [subscribe, addEntry]);
}

function useAutoScroll(
  entries: LogEntry[],
  contentRef: RefObject<HTMLDivElement | null>,
): () => void {
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [entries, contentRef]);

  return useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, [contentRef]);
}

export function useLogStream(): UseLogStreamResult {
  const connected = useEventStore((s) => s.connected);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);

  useLogHistory(setEntries);
  useLogSubscription(setEntries);
  const handleScroll = useAutoScroll(entries, contentRef);

  return { entries, contentRef, handleScroll, connected };
}
