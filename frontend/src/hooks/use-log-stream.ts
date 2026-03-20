import { useEffect, useRef, useState, useCallback } from "react";
import { useEventContext } from "../context/EventContext";
import type { EngineEvent, EngineEventType } from "../types/events";
import { formatTime } from "../utils/format";
import { LOG_MAX_LINES } from "../constants";
import { api } from "../api/client";
import { computeCost, formatCost } from "../utils/pricing";

export interface LogEntry {
  timestamp: string;
  type: EngineEventType;
  summary: string;
  detail: EngineEvent;
}

const EVENT_LABELS: Record<EngineEventType, string> = {
  loop_started: "Loop",
  loop_paused: "Loop",
  loop_stopped: "Loop",
  loop_finished: "Loop",
  loop_iteration_summary: "Loop",
  task_started: "Task",
  task_completed: "Task",
  task_failed: "Task",
  task_retrying: "Task",
  task_became_ready: "Task",
  tasks_became_ready: "Task",
  task_output_delta: "Output",
  file_ops_applied: "Files",
  follow_up_task_created: "Task",
  session_rolled_over: "Session",
  log_line: "Log",
  spec_gen_started: "Spec",
  spec_gen_progress: "Spec",
  spec_gen_completed: "Spec",
  spec_gen_failed: "Spec",
  spec_saved: "Spec",
  build_verification_skipped: "Build",
  build_verification_started: "Build",
  build_verification_passed: "Build",
  build_verification_failed: "Build",
  build_fix_attempt: "Build",
  test_verification_started: "Test",
  test_verification_passed: "Test",
  test_verification_failed: "Test",
  test_fix_attempt: "Test",
  git_committed: "Git",
  git_pushed: "Git",
  network_event: "Network",
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

function summariseLoopEvent(e: EngineEvent): string {
  switch (e.type) {
    case "loop_started":
      return "Dev loop started";
    case "loop_paused":
      return `Loop paused (${e.completed_count ?? 0} completed)`;
    case "loop_stopped":
      return `Loop stopped (${e.completed_count ?? 0} completed)`;
    case "loop_finished": {
      const parts = [`Loop finished: ${e.outcome ?? "unknown"}`];
      if (e.tasks_completed != null) {
        const dur = e.total_duration_ms != null ? ` in ${fmtDuration(e.total_duration_ms)}` : "";
        parts[0] = `Loop finished: ${e.tasks_completed} tasks${dur}`;
      }
      if (e.total_input_tokens != null && e.total_output_tokens != null) {
        const tokens = fmtTokens(e.total_input_tokens + e.total_output_tokens);
        const cost = e.total_cost_usd != null
          ? formatCost(e.total_cost_usd)
          : formatCost(computeCost(e.total_input_tokens, e.total_output_tokens));
        parts.push(`${tokens} tokens, ${cost} (est.)`);
      }
      if (e.tasks_retried) parts.push(`${e.tasks_retried} retries`);
      if (e.sessions_used && e.sessions_used > 1) parts.push(`${e.sessions_used} sessions`);
      if (e.total_build_fix_attempts) parts.push(`${e.total_build_fix_attempts} build fixes`);
      if (e.total_parse_retries) parts.push(`${e.total_parse_retries} parse retries`);
      return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(", ")})` : parts[0];
    }
    case "loop_iteration_summary": {
      if (!e.phase_timings || e.phase_timings.length === 0) return `Task breakdown: ${e.task_id}`;
      const breakdown = e.phase_timings
        .map((p) => `${p.phase} ${fmtDuration(p.duration_ms)}`)
        .join(", ");
      return `Task breakdown: ${breakdown}`;
    }
    default:
      return e.type;
  }
}

function summariseTaskEvent(e: EngineEvent): string {
  switch (e.type) {
    case "task_started": {
      const name = e.task_title || e.task_id;
      if (e.codebase_snapshot_bytes != null) {
        const kb = (e.codebase_snapshot_bytes / 1024).toFixed(0);
        return `Started: ${name} (snapshot: ${kb}KB, ${e.codebase_file_count ?? "?"} files)`;
      }
      return `Started: ${name}`;
    }
    case "task_completed": {
      const name = e.task_title || e.task_id;
      const parts: string[] = [];
      if (e.duration_ms != null) parts.push(fmtDuration(e.duration_ms));
      if (e.input_tokens != null && e.output_tokens != null) {
        parts.push(`${fmtTokens(e.input_tokens + e.output_tokens)} tokens`);
        const taskCost = e.cost_usd != null
          ? formatCost(e.cost_usd)
          : formatCost(computeCost(e.input_tokens, e.output_tokens, e.model));
        parts.push(`${taskCost} (est.)`);
      }
      if (e.parse_retries) parts.push(`${e.parse_retries} retries`);
      if (e.build_fix_attempts) parts.push(`${e.build_fix_attempts} build fix${e.build_fix_attempts > 1 ? "es" : ""}`);
      return parts.length > 0
        ? `Completed: ${name} (${parts.join(", ")})`
        : `Completed: ${name}`;
    }
    case "task_failed": {
      const name = e.task_title || e.task_id;
      const parts: string[] = [];
      if (e.duration_ms != null) parts.push(fmtDuration(e.duration_ms));
      if (e.phase) parts.push(`phase: ${e.phase}`);
      if (e.build_fix_attempts) parts.push(`${e.build_fix_attempts} fix attempts`);
      return `Failed: ${name}${parts.length > 0 ? ` (${parts.join(", ")})` : ""} — ${e.reason || "unknown"}`;
    }
    case "task_retrying":
      return `Retrying: ${e.task_id} (attempt ${e.attempt ?? "?"})`;
    case "task_became_ready":
      return `Task ready: ${e.task_id}`;
    case "tasks_became_ready":
      return `Tasks ready: ${(e.task_ids ?? []).length} task(s)`;
    case "task_output_delta":
      return `Output: ${(e.delta ?? "").slice(0, 80)}`;
    case "file_ops_applied":
      return `Files: ${e.files_written ?? 0} written, ${e.files_deleted ?? 0} deleted`;
    case "follow_up_task_created":
      return `Follow-up created: ${e.task_id}`;
    default:
      return e.type;
  }
}

function summariseSessionEvent(e: EngineEvent): string {
  switch (e.type) {
    case "session_rolled_over": {
      const parts: string[] = [];
      if (e.context_usage_pct != null) parts.push(`usage: ${e.context_usage_pct.toFixed(0)}%`);
      if (e.summary_duration_ms != null) parts.push(`summary took ${fmtDuration(e.summary_duration_ms)}`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return `Context rotated${detail} → Session ${e.new_session_id?.slice(0, 8)}`;
    }
    case "log_line":
      return e.message || "";
    default:
      return e.type;
  }
}

function summariseSpecEvent(e: EngineEvent): string {
  switch (e.type) {
    case "spec_gen_started":
      return "Spec generation started";
    case "spec_gen_progress":
      return `Spec generation: ${e.stage ?? ""}`;
    case "spec_gen_completed":
      return `Spec generation completed (${e.spec_count ?? 0} specs)`;
    case "spec_gen_failed":
      return `Spec generation failed: ${e.reason ?? "unknown"}`;
    case "spec_saved":
      return `Spec saved: ${e.spec?.title ?? e.project_id}`;
    default:
      return e.type;
  }
}

function summariseBuildEvent(e: EngineEvent): string {
  switch (e.type) {
    case "build_verification_skipped":
      return `Build verification skipped${e.reason ? `: ${e.reason}` : ""}`;
    case "build_verification_started":
      return `Build verification started${e.task_id ? `: ${e.task_id}` : ""}`;
    case "build_verification_passed": {
      const dur = e.duration_ms != null ? ` (${fmtDuration(e.duration_ms)})` : "";
      return `Build passed${dur}`;
    }
    case "build_verification_failed": {
      const parts: string[] = [];
      if (e.duration_ms != null) parts.push(fmtDuration(e.duration_ms));
      if (e.attempt != null) parts.push(`attempt ${e.attempt}`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return `Build failed${detail}`;
    }
    case "build_fix_attempt":
      return `Build fix attempt${e.attempt ? ` #${e.attempt}` : ""}`;
    default:
      return e.type;
  }
}

function summariseTestEvent(e: EngineEvent): string {
  switch (e.type) {
    case "test_verification_started":
      return `Test verification started${e.task_id ? `: ${e.task_id}` : ""}`;
    case "test_verification_passed": {
      const dur = e.duration_ms != null ? ` (${fmtDuration(e.duration_ms)})` : "";
      return `Test passed${dur}`;
    }
    case "test_verification_failed": {
      const parts: string[] = [];
      if (e.duration_ms != null) parts.push(fmtDuration(e.duration_ms));
      if (e.attempt != null) parts.push(`attempt ${e.attempt}`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return `Test failed${detail}`;
    }
    case "test_fix_attempt":
      return `Test fix attempt${e.attempt ? ` #${e.attempt}` : ""}`;
    default:
      return e.type;
  }
}

function summarise(e: EngineEvent): string {
  switch (e.type) {
    case "loop_started":
    case "loop_paused":
    case "loop_stopped":
    case "loop_finished":
    case "loop_iteration_summary":
      return summariseLoopEvent(e);
    case "task_started":
    case "task_completed":
    case "task_failed":
    case "task_retrying":
    case "task_became_ready":
    case "tasks_became_ready":
    case "task_output_delta":
    case "file_ops_applied":
    case "follow_up_task_created":
      return summariseTaskEvent(e);
    case "session_rolled_over":
    case "log_line":
      return summariseSessionEvent(e);
    case "spec_gen_started":
    case "spec_gen_progress":
    case "spec_gen_completed":
    case "spec_gen_failed":
    case "spec_saved":
      return summariseSpecEvent(e);
    case "build_verification_skipped":
    case "build_verification_started":
    case "build_verification_passed":
    case "build_verification_failed":
    case "build_fix_attempt":
      return summariseBuildEvent(e);
    case "test_verification_started":
    case "test_verification_passed":
    case "test_verification_failed":
    case "test_fix_attempt":
      return summariseTestEvent(e);
    case "git_committed":
      return `Git commit: ${e.commit_sha?.slice(0, 8) ?? e.task_id ?? ""}`;
    case "git_pushed":
      return `Git push: ${e.branch ?? e.task_id ?? ""}`;
    case "network_event":
      return `Network: ${e.network_event_type ?? "event"}`;
    default:
      return e.type;
  }
}

export { EVENT_LABELS };

export function useLogStream() {
  const { subscribe, connected } = useEventContext();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const historyLoadedRef = useRef(false);

  useEffect(() => {
    if (historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    api.getLogEntries(LOG_MAX_LINES).then((persisted) => {
      if (persisted.length === 0) return;
      const restored: LogEntry[] = persisted.map((p) => ({
        timestamp: formatTime(new Date(p.timestamp_ms)),
        type: p.event.type,
        summary: summarise(p.event),
        detail: p.event,
      }));
      setEntries((prev) => {
        const combined = [...restored, ...prev];
        return combined.length > LOG_MAX_LINES
          ? combined.slice(-LOG_MAX_LINES)
          : combined;
      });
    }).catch(() => {
      // Silently ignore load failures; live events still work
    });

    return () => { historyLoadedRef.current = false; };
  }, []);

  const addEntry = useCallback((event: EngineEvent) => {
    setEntries((prev) => {
      const entry: LogEntry = {
        timestamp: formatTime(new Date()),
        type: event.type,
        summary: summarise(event),
        detail: event,
      };
      const next = [...prev, entry];
      return next.length > LOG_MAX_LINES ? next.slice(-LOG_MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    const allTypes: EngineEventType[] = [
      "loop_started",
      "loop_paused",
      "loop_stopped",
      "loop_finished",
      "loop_iteration_summary",
      "task_started",
      "task_completed",
      "task_failed",
      "task_retrying",
      "task_became_ready",
      "tasks_became_ready",
      "task_output_delta",
      "file_ops_applied",
      "follow_up_task_created",
      "session_rolled_over",
      "log_line",
      "spec_gen_started",
      "spec_gen_progress",
      "spec_gen_completed",
      "spec_gen_failed",
      "spec_saved",
      "build_verification_skipped",
      "build_verification_started",
      "build_verification_passed",
      "build_verification_failed",
      "build_fix_attempt",
      "test_verification_started",
      "test_verification_passed",
      "test_verification_failed",
      "test_fix_attempt",
      "git_committed",
      "git_pushed",
      "network_event",
    ];
    const unsubs = allTypes.map((type) =>
      subscribe(type, (e) => addEntry(e)),
    );
    return () => unsubs.forEach((u) => u());
  }, [subscribe, addEntry]);

  useEffect(() => {
    if (autoScrollRef.current && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [entries]);

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, []);

  return { entries, contentRef, handleScroll, connected };
}
