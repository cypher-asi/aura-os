/* ── PhaseTimingEntry ─────────────────────────────────────────────── */

export interface PhaseTimingEntry {
  phase: string;
  duration_ms: number;
}

/* ── LoopId / LoopActivity (backend: aura-os-events) ─────────────── */

export type LoopKind = "chat" | "automation" | "task_run" | "spec_gen" | "process_run";

export type LoopStatus =
  | "starting"
  | "running"
  | "waiting_tool"
  | "compacting"
  | "stalled"
  | "completed"
  | "failed"
  | "cancelled";

export interface LoopIdPayload {
  user_id: string;
  project_id?: string | null;
  agent_instance_id?: string | null;
  agent_id: string;
  kind: LoopKind;
  instance: string;
}

export interface LoopActivityPayload {
  status: LoopStatus;
  percent?: number | null;
  started_at: string;
  last_event_at: string;
  current_task_id?: string | null;
  current_step?: string | null;
}

/**
 * `true` when the loop activity should render a spinner in the UI.
 * Mirrors the backend `LoopStatus::is_active` taxonomy so the same
 * status values produce the same visual treatment everywhere.
 */
export function isLoopActivityActive(status: LoopStatus): boolean {
  return (
    status === "starting" ||
    status === "running" ||
    status === "waiting_tool" ||
    status === "compacting" ||
    status === "stalled"
  );
}

/* ── ChatAttachment (shared by SSE + event schema) ────────────────── */

export interface ChatAttachment {
  type: "image" | "text";
  media_type: string;
  data: string;
  name?: string;
}

/* ── Sender (mirrors `session_events.sender`) ─────────────────────── */

export type Sender = "user" | "agent";
