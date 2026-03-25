import type { AgentInstance, SessionEvent, Spec, Task } from "./entities";
import type {
  SessionReady as HarnessSessionReady,
  AssistantMessageStart as HarnessAssistantMessageStart,
  AssistantMessageEnd as HarnessAssistantMessageEnd,
  TextDelta as HarnessTextDelta,
  ToolUseStart as HarnessToolUseStart,
} from "./harness-protocol";

/* ── PhaseTimingEntry ─────────────────────────────────────────────── */

export interface PhaseTimingEntry {
  phase: string;
  duration_ms: number;
}

/* ── ChatAttachment (shared by SSE + event schema) ────────────────── */

export interface ChatAttachment {
  type: "image" | "text";
  media_type: string;
  data: string;
  name?: string;
}

/* ── EventType enum ─────────────────────────────────────────────────
 * Single source of truth — maps 1:1 with the backend DB enum.
 * String values are the wire/storage format.
 * ------------------------------------------------------------------ */

export enum EventType {
  // Message lifecycle
  UserMessage           = "user_message",
  MessageStart          = "message_start",
  MessageEnd            = "message_end",

  // Streaming (within MessageStart..MessageEnd)
  Delta                 = "delta",
  ThinkingDelta         = "thinking_delta",
  Progress              = "progress",
  ToolCallStarted       = "tool_call_started",
  ToolCallSnapshot      = "tool_call_snapshot",
  ToolCall              = "tool_call",
  ToolResult            = "tool_result",
  TokenUsage            = "token_usage",
  Done                  = "done",

  // Harness protocol (local harness wire format)
  SessionReady              = "session_ready",
  AssistantMessageStart     = "assistant_message_start",
  AssistantMessageEnd       = "assistant_message_end",
  TextDelta                 = "text_delta",
  ToolUseStart              = "tool_use_start",

  // Agent state
  AgentInstanceUpdated  = "agent_instance_updated",

  // Spec generation
  SpecSaved             = "spec_saved",
  SpecsTitle            = "specs_title",
  SpecsSummary          = "specs_summary",
  SpecGenStarted        = "spec_gen_started",
  SpecGenProgress       = "spec_gen_progress",
  SpecGenCompleted      = "spec_gen_completed",
  SpecGenFailed         = "spec_gen_failed",
  SpecGenerating        = "generating",
  SpecGenComplete       = "complete",

  // Task lifecycle
  TaskSaved             = "task_saved",
  TaskStarted           = "task_started",
  TaskCompleted         = "task_completed",
  TaskFailed            = "task_failed",
  TaskRetrying          = "task_retrying",
  TaskBecameReady       = "task_became_ready",
  TasksBecameReady      = "tasks_became_ready",
  TaskOutputDelta       = "task_output_delta",
  FollowUpTaskCreated   = "follow_up_task_created",
  FileOpsApplied        = "file_ops_applied",

  // Loop lifecycle
  LoopStarted           = "loop_started",
  LoopPaused            = "loop_paused",
  LoopResumed           = "loop_resumed",
  LoopStopped           = "loop_stopped",
  LoopFinished          = "loop_finished",
  LoopIterationSummary  = "loop_iteration_summary",
  SessionRolledOver     = "session_rolled_over",

  // Build verification
  BuildVerificationSkipped  = "build_verification_skipped",
  BuildVerificationStarted  = "build_verification_started",
  BuildVerificationPassed   = "build_verification_passed",
  BuildVerificationFailed   = "build_verification_failed",
  BuildFixAttempt           = "build_fix_attempt",

  // Test verification
  TestVerificationStarted   = "test_verification_started",
  TestVerificationPassed    = "test_verification_passed",
  TestVerificationFailed    = "test_verification_failed",
  TestFixAttempt            = "test_fix_attempt",

  // Git
  GitCommitted          = "git_committed",
  GitPushed             = "git_pushed",

  // Other
  LogLine               = "log_line",
  NetworkEvent          = "network_event",
  Error                 = "error",
}

/* ── Sender & AuraEventBase ─────────────────────────────────────────
 * Mirrors the `session_events` table columns.
 * ------------------------------------------------------------------ */

export type Sender = "user" | "agent";

export interface AuraEventBase {
  event_id: string;
  session_id: string;
  user_id: string;
  agent_id: string;
  sender: Sender;
  project_id: string;
  org_id: string;
  type: EventType;
  created_at: string;
}

/* ── AuraEvent discriminated union ──────────────────────────────────
 * Each variant has a `type` from EventType and a `content` whose
 * shape depends on the type — mirroring the DB's JSONB column.
 * ------------------------------------------------------------------ */

export type AuraEvent = AuraEventBase & (
  // ── Message lifecycle ──────────────────────────────────────
  | { type: EventType.UserMessage; content: {
      message_id: string;
      text: string;
      attachments?: ChatAttachment[];
    } }
  | { type: EventType.MessageStart; content: {
      message_id: string;
      role: "assistant" | "system";
    } }
  | { type: EventType.MessageEnd; content: {
      message_id: string;
      event: SessionEvent;
    } }

  // ── Streaming (within MessageStart..MessageEnd) ─────────────
  | { type: EventType.Delta; content: {
      message_id?: string;
      text: string;
    } }
  | { type: EventType.ThinkingDelta; content: {
      message_id?: string;
      text?: string;
      thinking?: string;
    } }
  | { type: EventType.Progress; content: {
      message_id?: string;
      stage: string;
    } }
  | { type: EventType.ToolCallStarted; content: {
      message_id?: string;
      id: string;
      name: string;
    } }
  | { type: EventType.ToolCallSnapshot; content: {
      message_id?: string;
      id: string;
      name: string;
      input: Record<string, unknown>;
    } }
  | { type: EventType.ToolCall; content: {
      message_id?: string;
      id: string;
      name: string;
      input: Record<string, unknown>;
    } }
  | { type: EventType.ToolResult; content: {
      message_id?: string;
      id?: string;
      name: string;
      result: string;
      is_error: boolean;
    } }
  | { type: EventType.TokenUsage; content: {
      message_id?: string;
      input_tokens: number;
      output_tokens: number;
    } }
  | { type: EventType.Done; content: {
      message_id?: string;
    } }

  // ── Agent state ────────────────────────────────────────────
  | { type: EventType.AgentInstanceUpdated; content: {
      agent_instance: AgentInstance;
    } }

  // ── Spec generation ────────────────────────────────────────
  | { type: EventType.SpecSaved; content: {
      spec: Spec;
      spec_id?: string;
    } }
  | { type: EventType.SpecsTitle; content: { title: string } }
  | { type: EventType.SpecsSummary; content: { summary: string } }
  | { type: EventType.SpecGenStarted; content: Record<string, never> }
  | { type: EventType.SpecGenProgress; content: {
      stage: string;
      spec_count?: number;
    } }
  | { type: EventType.SpecGenCompleted; content: {
      spec_count?: number;
    } }
  | { type: EventType.SpecGenFailed; content: { reason?: string } }
  | { type: EventType.SpecGenerating; content: { tokens: number } }
  | { type: EventType.SpecGenComplete; content: { specs: Spec[] } }

  // ── Task lifecycle ─────────────────────────────────────────
  | { type: EventType.TaskSaved; content: { task: Task } }
  | { type: EventType.TaskStarted; content: {
      task_id: string;
      task_title?: string;
      codebase_snapshot_bytes?: number;
      codebase_file_count?: number;
    } }
  | { type: EventType.TaskCompleted; content: {
      task_id: string;
      task_title?: string;
      outcome?: string;
      execution_notes?: string;
      duration_ms?: number;
      files_changed_count?: number;
      files?: { op: string; path: string }[];
      input_tokens?: number;
      output_tokens?: number;
      cost_usd?: number;
      model?: string;
      parse_retries?: number;
      build_fix_attempts?: number;
    } }
  | { type: EventType.TaskFailed; content: {
      task_id: string;
      task_title?: string;
      reason?: string;
      duration_ms?: number;
      phase?: string;
      build_fix_attempts?: number;
    } }
  | { type: EventType.TaskRetrying; content: {
      task_id: string;
      attempt: number;
      reason?: string;
    } }
  | { type: EventType.TaskBecameReady; content: { task_id: string } }
  | { type: EventType.TasksBecameReady; content: {
      task_ids: string[];
    } }
  | { type: EventType.TaskOutputDelta; content: {
      task_id: string;
      delta: string;
    } }
  | { type: EventType.FollowUpTaskCreated; content: {
      task_id: string;
    } }
  | { type: EventType.FileOpsApplied; content: {
      task_id: string;
      files: { op: string; path: string }[];
      files_written?: number;
      files_deleted?: number;
    } }

  // ── Loop lifecycle ─────────────────────────────────────────
  | { type: EventType.LoopStarted; content: {
      automaton_id?: string;
    } }
  | { type: EventType.LoopPaused; content: {
      completed_count?: number;
    } }
  | { type: EventType.LoopResumed; content: Record<string, never> }
  | { type: EventType.LoopStopped; content: {
      completed_count?: number;
      tasks_completed?: number;
      tasks_failed?: number;
      total_duration_ms?: number;
      total_cost_usd?: number;
    } }
  | { type: EventType.LoopFinished; content: {
      outcome?: string;
      tasks_completed?: number;
      tasks_failed?: number;
      total_duration_ms?: number;
      total_input_tokens?: number;
      total_output_tokens?: number;
      total_cost_usd?: number;
      tasks_retried?: number;
      sessions_used?: number;
      total_build_fix_attempts?: number;
      total_parse_retries?: number;
    } }
  | { type: EventType.LoopIterationSummary; content: {
      task_id?: string;
      phase_timings?: PhaseTimingEntry[];
      duration_ms?: number;
    } }
  | { type: EventType.SessionRolledOver; content: {
      old_session_id: string;
      new_session_id: string;
      task_id?: string;
      context_usage_pct?: number;
      summary_duration_ms?: number;
    } }

  // ── Build verification ─────────────────────────────────────
  | { type: EventType.BuildVerificationSkipped; content: {
      task_id: string;
      reason?: string;
      command?: string;
    } }
  | { type: EventType.BuildVerificationStarted; content: {
      task_id: string;
      command?: string;
    } }
  | { type: EventType.BuildVerificationPassed; content: {
      task_id: string;
      stdout?: string;
      duration_ms?: number;
    } }
  | { type: EventType.BuildVerificationFailed; content: {
      task_id: string;
      stderr?: string;
      stdout?: string;
      duration_ms?: number;
      attempt?: number;
    } }
  | { type: EventType.BuildFixAttempt; content: {
      task_id: string;
      attempt: number;
      stderr?: string;
    } }

  // ── Test verification ──────────────────────────────────────
  | { type: EventType.TestVerificationStarted; content: {
      task_id: string;
      command?: string;
    } }
  | { type: EventType.TestVerificationPassed; content: {
      task_id: string;
      tests?: { name: string; status: string; message?: string }[];
      summary?: string;
      duration_ms?: number;
    } }
  | { type: EventType.TestVerificationFailed; content: {
      task_id: string;
      tests?: { name: string; status: string; message?: string }[];
      stderr?: string;
      summary?: string;
      duration_ms?: number;
      attempt?: number;
    } }
  | { type: EventType.TestFixAttempt; content: {
      task_id: string;
      attempt: number;
      stderr?: string;
    } }

  // ── Git ────────────────────────────────────────────────────
  | { type: EventType.GitCommitted; content: {
      task_id?: string;
      commit_sha: string;
      spec_id?: string;
    } }
  | { type: EventType.GitPushed; content: {
      task_id?: string;
      spec_id?: string;
      summary?: string;
      repo?: string;
      branch?: string;
      commits?: { sha: string; message: string }[];
    } }

  // ── Harness protocol (canonical types from aura-protocol) ────
  | { type: EventType.SessionReady; content: HarnessSessionReady }
  | { type: EventType.AssistantMessageStart; content: HarnessAssistantMessageStart }
  | { type: EventType.AssistantMessageEnd; content: HarnessAssistantMessageEnd }
  | { type: EventType.TextDelta; content: HarnessTextDelta }
  | { type: EventType.ToolUseStart; content: HarnessToolUseStart }

  // ── Other ──────────────────────────────────────────────────
  | { type: EventType.LogLine; content: {
      message: string;
      task_id?: string;
    } }
  | { type: EventType.NetworkEvent; content: {
      network_event_type: string;
      payload: Record<string, unknown>;
    } }
  | { type: EventType.Error; content: {
      message: string;
      task_id?: string;
    } }
);

/* ── Helper types ─────────────────────────────────────────────────── */

export type AuraEventOfType<T extends EventType> =
  Extract<AuraEvent, { type: T }>;

export type AuraEventContent<T extends EventType> =
  AuraEventOfType<T>["content"];

export function isValidEventType(value: string): value is EventType {
  return Object.values(EventType).includes(value as EventType);
}

/* ── parseAuraEvent — bridge function ─────────────────────────────
 * Used by both SSE and WS consumers to wrap current transport
 * payloads into the canonical AuraEvent shape.
 *
 * When the backend starts emitting full session_events rows this
 * function becomes a passthrough.
 * ------------------------------------------------------------------ */

export function parseAuraEvent(
  type: string,
  data: unknown,
  context: {
    session_id?: string;
    user_id?: string;
    agent_id?: string;
    project_id?: string;
    org_id?: string;
    sender?: Sender;
  },
): AuraEvent {
  const eventType = type as EventType;
  const d = (data ?? {}) as Record<string, unknown>;

  return {
    event_id: crypto.randomUUID(),
    session_id: context.session_id ?? (d.session_id as string) ?? "",
    user_id: context.user_id ?? "",
    agent_id: context.agent_id ?? (d.agent_instance_id as string) ?? "",
    sender: context.sender ?? (eventType === EventType.UserMessage ? "user" : "agent"),
    project_id: context.project_id ?? (d.project_id as string) ?? "",
    org_id: context.org_id ?? "",
    type: eventType,
    content: d,
    created_at: new Date().toISOString(),
  } as AuraEvent;
}
