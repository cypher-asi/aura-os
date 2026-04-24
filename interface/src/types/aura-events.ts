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
  /**
   * Emitted by aura-harness (see `AgentLoopEvent::ToolCallRetrying`
   * in crates/aura-agent/src/events/mod.rs) when its internal
   * streaming-retry-with-backoff loop is about to re-request the
   * current `tool_use` from the provider. The UI uses this to
   * render a live "Write retrying (n/8)..." state on the tool card
   * that owns the `tool_use_id`.
   */
  ToolCallRetrying      = "tool_call_retrying",
  /**
   * Emitted by aura-harness (see `AgentLoopEvent::ToolCallFailed`)
   * once the streaming-retry budget is exhausted and the tool call
   * is terminally failed from the harness's perspective. The server
   * routes the same event through its per-task
   * `TOOL_CALL_RETRY_BUDGET` (apps/aura-os-server/src/handlers/dev_loop.rs)
   * before it reaches the UI, so seeing this event in the UI means
   * both retry ladders gave up. Renders as a red failure badge with
   * the classified reason inline.
   */
  ToolCallFailed        = "tool_call_failed",
  TokenUsage            = "token_usage",
  Done                  = "done",

  // Harness protocol (local harness wire format)
  SessionReady              = "session_ready",
  AssistantMessageStart     = "assistant_message_start",
  AssistantMessageEnd       = "assistant_message_end",
  TextDelta                 = "text_delta",
  ToolUseStart              = "tool_use_start",

  // Agent state
  AgentInstanceUpdated      = "agent_instance_updated",
  RemoteAgentStateChanged   = "remote_agent_state_changed",

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
  FollowUpTaskCreated   = "follow_up_task_created",
  FileOpsApplied        = "file_ops_applied",
  /**
   * Audit event emitted by the server's Definition-of-Done gate after a
   * `task_completed` is inspected (see `completion_validation_failure_reason`
   * in `aura-os-server/src/handlers/dev_loop.rs`). `passed === false`
   * indicates the server rewrote the event into `task_failed` because the
   * run lacked required evidence (empty-path writes, no build, no test,
   * etc.). Carries `failure_reason` + the gate report counters.
   */
  TaskCompletionGate    = "task_completion_gate",

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
  GitCommitFailed       = "git_commit_failed",
  /// Emitted when the DoD completion gate rejects a task *after* the
  /// automaton already reported `git_committed`. The SHA carried in
  /// the event cannot be reached from `git log` (the push was never
  /// made, and the commit is effectively orphaned). The UI renders
  /// this as a muted/strikethrough row so users are not misled by a
  /// committed-looking SHA that does not actually exist on main.
  GitCommitRolledBack   = "git_commit_rolled_back",
  GitPushed             = "git_pushed",
  GitPushFailed         = "git_push_failed",
  /// Emitted on every push failure (transient or terminal). Carries
  /// the task/project context and the classified failure reason so
  /// the UI can surface a muted "Push deferred" row on the task card
  /// without the red "push_failed" styling.
  PushDeferred          = "push_deferred",
  /// Emitted ONCE per streak when a project accumulates
  /// CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD back-to-back push
  /// failures. The UI uses this as a signal to mount a persistent
  /// banner on the project header until a successful push clears it.
  ProjectPushStuck      = "project_push_stuck",

  // Billing
  CreditBalanceUpdated  = "credit_balance_updated",

  // Process execution
  ProcessRunStarted     = "process_run_started",
  ProcessRunProgress    = "process_run_progress",
  ProcessRunCompleted   = "process_run_completed",
  ProcessRunFailed      = "process_run_failed",
  ProcessNodeExecuted   = "process_node_executed",
  ProcessNodeOutputDelta = "process_node_output_delta",

  // Generation (image / 3D)
  GenerationStart       = "generation_start",
  GenerationProgress    = "generation_progress",
  GenerationPartialImage = "generation_partial_image",
  GenerationCompleted   = "generation_completed",
  GenerationError       = "generation_error",

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
  | { type: EventType.ToolCallRetrying; content: {
      message_id?: string;
      /** Harness-side `tool_use_id`; must match the `id` on the
       *  originating ToolCallStarted / ToolCallSnapshot so the UI can
       *  locate the tool card to annotate. */
      tool_use_id: string;
      tool_name: string;
      /** 1-indexed attempt number that is about to start. */
      attempt: number;
      /** Total retry budget (default 8; see
       *  `AURA_LLM_MAX_RETRIES` on the harness side). */
      max_attempts: number;
      /** Backoff delay before this attempt, in milliseconds. */
      delay_ms: number;
      /** Classifier-produced reason string the harness is
       *  retrying (`provider 5xx` / `429` / `stream aborted` / etc.). */
      reason: string;
      task_id?: string;
    } }
  | { type: EventType.ToolCallFailed; content: {
      message_id?: string;
      tool_use_id: string;
      tool_name: string;
      reason: string;
      task_id?: string;
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
  | { type: EventType.RemoteAgentStateChanged; content: {
      agent_id: string;
      state: string;
      uptime_seconds: number;
      active_sessions: number;
      error_message?: string;
      action?: string;
      phase?: string;
      vm_id?: string;
      previous_vm_id?: string;
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
      /**
       * Axis 5 resume preamble ("[aura-retry attempt=N] …") built by the
       * dev loop. Kept optional on the wire so older servers still
       * parse cleanly; handlers that surface it to users should fall
       * back to a generic string when absent.
       */
      preamble?: string;
    } }
  | { type: EventType.TaskBecameReady; content: { task_id: string } }
  | { type: EventType.TasksBecameReady; content: {
      task_ids: string[];
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
  | { type: EventType.TaskCompletionGate; content: {
      task_id: string;
      passed: boolean;
      failure_reason?: string;
      had_live_output: boolean;
      n_files_changed: number;
      has_source_change: boolean;
      has_rust_change: boolean;
      n_build_steps: number;
      n_test_steps: number;
      n_format_steps: number;
      n_lint_steps: number;
      n_empty_path_writes: number;
      recovery_checkpoint: string;
    } }

  // ── Loop lifecycle ─────────────────────────────────────────
  | { type: EventType.LoopStarted; content: {
      automaton_id?: string;
    } }
  | { type: EventType.LoopPaused; content: {
      completed_count?: number;
      /** Task whose failure triggered the pause, when applicable. */
      task_id?: string;
      /** Human-readable reason the loop paused (e.g. rate-limit details). */
      reason?: string;
      /** Classified infra-failure kind: `provider_rate_limited`, `provider_overloaded`, `transport_timeout`, `git_timeout`. */
      retry_kind?: string;
      /** How long the loop will remain paused before auto-resume, in milliseconds. */
      cooldown_ms?: number;
    } }
  | { type: EventType.LoopResumed; content: {
      task_id?: string;
      reason?: string;
      retry_kind?: string;
    } }
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
  | { type: EventType.GitCommitFailed; content: {
      task_id?: string;
      reason: string;
    } }
  | { type: EventType.GitCommitRolledBack; content: {
      task_id?: string;
      commit_sha: string;
      reason: string;
    } }
  | { type: EventType.GitPushed; content: {
      task_id?: string;
      spec_id?: string;
      summary?: string;
      repo?: string;
      branch?: string;
      commits?: { sha: string; message: string }[];
    } }
  | { type: EventType.GitPushFailed; content: {
      task_id?: string;
      reason: string;
      commit_sha?: string;
      repo?: string;
      branch?: string;
      retry_safe?: boolean;
    } }
  | { type: EventType.PushDeferred; content: {
      task_id?: string;
      reason: string;
      /** Failure classifier, e.g. `remote_rejected`, `transport_timeout`,
       *  `remote_storage_exhausted`. */
      class?: string;
      commit_sha?: string | null;
      /** Operator-facing remediation hint populated for classes the
       *  server knows how to talk about (currently only
       *  `remote_storage_exhausted`). */
      remediation?: string | null;
      /** Seconds until the orbit capacity guard will let retries
       *  resume. Populated when orbit is in cooldown after an
       *  ENOSPC trip; otherwise absent / null. */
      retry_after_secs?: number | null;
    } }
  | { type: EventType.ProjectPushStuck; content: {
      task_id?: string;
      /** The streak threshold that was hit (default 3). */
      threshold: number;
      /** Last observed failure classifier. */
      class?: string;
      reason: string;
      /** Operator-facing remediation hint, mirrors the `push_deferred`
       *  payload so the banner can render actionable guidance. */
      remediation?: string | null;
      /** Seconds until the orbit capacity guard will let retries
       *  resume (for `remote_storage_exhausted` only). */
      retry_after_secs?: number | null;
    } }

  // ── Harness protocol (canonical types from aura-protocol) ────
  | { type: EventType.SessionReady; content: HarnessSessionReady }
  | { type: EventType.AssistantMessageStart; content: HarnessAssistantMessageStart }
  | { type: EventType.AssistantMessageEnd; content: HarnessAssistantMessageEnd }
  | { type: EventType.TextDelta; content: HarnessTextDelta }
  | { type: EventType.ToolUseStart; content: HarnessToolUseStart }

  // ── Billing ────────────────────────────────────────────────
  | { type: EventType.CreditBalanceUpdated; content: {
      balance_cents: number;
      balance_formatted: string;
    } }

  // ── Process execution ────────────────────────────────────────
  | { type: EventType.ProcessRunStarted; content: {
      process_id: string;
      run_id: string;
    } }
  | { type: EventType.ProcessRunProgress; content: {
      process_id: string;
      run_id: string;
      total_input_tokens?: number;
      total_output_tokens?: number;
      cost_usd?: number;
    } }
  | { type: EventType.ProcessRunCompleted; content: {
      process_id: string;
      run_id: string;
      total_input_tokens?: number;
      total_output_tokens?: number;
      cost_usd?: number;
    } }
  | { type: EventType.ProcessRunFailed; content: {
      process_id: string;
      run_id: string;
      error?: string;
      total_input_tokens?: number;
      total_output_tokens?: number;
      cost_usd?: number;
    } }
  | { type: EventType.ProcessNodeExecuted; content: {
      process_id: string;
      run_id: string;
      node_id: string;
      node_type: string;
      status: string;
      input_tokens?: number;
      output_tokens?: number;
      model?: string;
    } }
  | { type: EventType.ProcessNodeOutputDelta; content: {
      process_id: string;
      run_id: string;
      node_id: string;
      delta_type?: "text" | "thinking" | "tool_use_start" | "tool_result";
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      result?: string;
      is_error?: boolean;
    } }

  // ── Generation (image / 3D) ─────────────────────────────────
  | { type: EventType.GenerationStart; content: {
      mode: "image" | "3d";
      ts?: string;
    } }
  | { type: EventType.GenerationProgress; content: {
      percent: number;
      message?: string;
    } }
  | { type: EventType.GenerationPartialImage; content: {
      data: string;
    } }
  | { type: EventType.GenerationCompleted; content: {
      mode: "image" | "3d";
      imageUrl?: string;
      originalUrl?: string;
      artifactId?: string;
      glbUrl?: string;
      polyCount?: number;
      meta?: Record<string, unknown>;
    } }
  | { type: EventType.GenerationError; content: {
      code?: string;
      message: string;
    } }

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
