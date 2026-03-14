import { useEffect, useRef, useState, useCallback } from "react";
import { useEventContext } from "../context/EventContext";
import type { EngineEvent, EngineEventType } from "../types/events";
import { formatTime } from "../utils/format";
import { LOG_MAX_LINES } from "../constants";
import { api } from "../api/client";

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
  task_started: "Task",
  task_completed: "Task",
  task_failed: "Task",
  task_retrying: "Task",
  task_became_ready: "Task",
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
  build_verification_started: "Build",
  build_verification_passed: "Build",
  build_verification_failed: "Build",
  build_fix_attempt: "Build",
  test_verification_started: "Test",
  test_verification_passed: "Test",
  test_verification_failed: "Test",
  test_fix_attempt: "Test",
};

function summarise(e: EngineEvent): string {
  switch (e.type) {
    case "loop_started":
      return "Dev loop started";
    case "loop_paused":
      return `Loop paused (${e.completed_count ?? 0} completed)`;
    case "loop_stopped":
      return `Loop stopped (${e.completed_count ?? 0} completed)`;
    case "loop_finished":
      return `Loop finished: ${e.outcome ?? "unknown"}`;
    case "task_started":
      return `Started: ${e.task_title || e.task_id}`;
    case "task_completed":
      return `Completed: ${e.task_title || e.task_id}`;
    case "task_failed":
      return `Failed: ${e.task_title || e.task_id} — ${e.reason || "unknown"}`;
    case "task_retrying":
      return `Retrying: ${e.task_id} (attempt ${e.attempt ?? "?"})`;
    case "task_became_ready":
      return `Task ready: ${e.task_id}`;
    case "task_output_delta":
      return `Output: ${(e.delta ?? "").slice(0, 80)}`;
    case "file_ops_applied":
      return `Files: ${e.files_written ?? 0} written, ${e.files_deleted ?? 0} deleted`;
    case "follow_up_task_created":
      return `Follow-up created: ${e.task_id}`;
    case "session_rolled_over":
      return `Context rotated → Session ${e.new_session_id?.slice(0, 8)}`;
    case "log_line":
      return e.message || "";
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
    case "build_verification_started":
      return `Build verification started${e.task_id ? `: ${e.task_id}` : ""}`;
    case "build_verification_passed":
      return `Build verification passed${e.task_id ? `: ${e.task_id}` : ""}`;
    case "build_verification_failed":
      return `Build verification failed${e.reason ? `: ${e.reason}` : ""}`;
    case "build_fix_attempt":
      return `Build fix attempt${e.attempt ? ` #${e.attempt}` : ""}`;
    case "test_verification_started":
      return `Test verification started${e.task_id ? `: ${e.task_id}` : ""}`;
    case "test_verification_passed":
      return `Test verification passed${e.task_id ? `: ${e.task_id}` : ""}`;
    case "test_verification_failed":
      return `Test verification failed${e.reason ? `: ${e.reason}` : ""}`;
    case "test_fix_attempt":
      return `Test fix attempt${e.attempt ? ` #${e.attempt}` : ""}`;
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
      "task_started",
      "task_completed",
      "task_failed",
      "task_retrying",
      "task_became_ready",
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
      "build_verification_started",
      "build_verification_passed",
      "build_verification_failed",
      "build_fix_attempt",
      "test_verification_started",
      "test_verification_passed",
      "test_verification_failed",
      "test_fix_attempt",
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
