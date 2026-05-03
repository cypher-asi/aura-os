import type { AgentInstance, SessionEvent, Spec, Task } from "../entities";
import type { EventType } from "./event-types";
import type {
  ChatAttachment,
  LoopActivityPayload,
  LoopIdPayload,
  PhaseTimingEntry,
} from "./payloads";

/**
 * Per-domain variants of `AuraEvent` covering the user/agent message
 * lifecycle, streaming, agent-instance state, spec generation, task
 * lifecycle, and loop lifecycle. Combined into the full discriminated
 * union in `event-types.ts`.
 */
export type DomainEventVariant =
  // ── Message lifecycle ──────────────────────────────────────
  | { type: typeof EventType.UserMessage; content: {
      message_id: string;
      text: string;
      attachments?: ChatAttachment[];
    } }
  | { type: typeof EventType.MessageStart; content: {
      message_id: string;
      role: "assistant" | "system";
    } }
  | { type: typeof EventType.MessageEnd; content: {
      message_id: string;
      event: SessionEvent;
    } }

  // ── Streaming (within MessageStart..MessageEnd) ─────────────
  | { type: typeof EventType.Delta; content: {
      message_id?: string;
      text: string;
    } }
  | { type: typeof EventType.ThinkingDelta; content: {
      message_id?: string;
      text?: string;
      thinking?: string;
    } }
  | { type: typeof EventType.Progress; content: {
      message_id?: string;
      stage: string;
    } }
  | { type: typeof EventType.ToolCallStarted; content: {
      message_id?: string;
      id: string;
      name: string;
    } }
  | { type: typeof EventType.ToolCallSnapshot; content: {
      message_id?: string;
      id: string;
      name: string;
      input: Record<string, unknown>;
    } }
  | { type: typeof EventType.ToolCall; content: {
      message_id?: string;
      id: string;
      name: string;
      input: Record<string, unknown>;
    } }
  | { type: typeof EventType.ToolResult; content: {
      message_id?: string;
      id?: string;
      name: string;
      result: string;
      is_error: boolean;
    } }
  | { type: typeof EventType.ToolCallRetrying; content: {
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
  | { type: typeof EventType.ToolCallFailed; content: {
      message_id?: string;
      tool_use_id: string;
      tool_name: string;
      reason: string;
      task_id?: string;
    } }
  | { type: typeof EventType.TokenUsage; content: {
      message_id?: string;
      input_tokens: number;
      output_tokens: number;
    } }
  | { type: typeof EventType.Done; content: {
      message_id?: string;
    } }

  // ── Agent state ────────────────────────────────────────────
  | { type: typeof EventType.AgentInstanceUpdated; content: {
      agent_instance: AgentInstance;
    } }
  | { type: typeof EventType.RemoteAgentStateChanged; content: {
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
  | { type: typeof EventType.SpecSaved; content: {
      spec: Spec;
      spec_id?: string;
    } }
  | { type: typeof EventType.SpecsTitle; content: { title: string } }
  | { type: typeof EventType.SpecsSummary; content: { summary: string } }
  | { type: typeof EventType.SpecGenStarted; content: Record<string, never> }
  | { type: typeof EventType.SpecGenProgress; content: {
      stage: string;
      spec_count?: number;
    } }
  | { type: typeof EventType.SpecGenCompleted; content: {
      spec_count?: number;
    } }
  | { type: typeof EventType.SpecGenFailed; content: { reason?: string } }
  | { type: typeof EventType.SpecGenerating; content: { tokens: number } }
  | { type: typeof EventType.SpecGenComplete; content: { specs: Spec[] } }

  // ── Task lifecycle ─────────────────────────────────────────
  | { type: typeof EventType.TaskSaved; content: { task: Task } }
  | { type: typeof EventType.TaskStarted; content: {
      task_id: string;
      task_title?: string;
      codebase_snapshot_bytes?: number;
      codebase_file_count?: number;
    } }
  | { type: typeof EventType.TaskCompleted; content: {
      task_id: string;
      task_title?: string;
      /**
       * Why the task was treated as complete. Recognised values:
       *   - `"insufficient_credits"` — credits-exhaustion shutdown (see
       *     `dev_loop/streaming/credits.rs`).
       *   - `"test_evidence_accepted"` — the harness reported a
       *     `CompletionContract` failure (no file edits, no
       *     `no_changes_needed: true`) but the dev-loop observed at
       *     least one successful test-runner invocation during the run,
       *     so the server bridged the task to `Done` instead. The
       *     synthetic event carries `test_pass_evidence` describing
       *     which runner satisfied the gate.
       *   - any other string — open-ended status the harness emitted.
       */
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
      /**
       * Present only when `outcome === "test_evidence_accepted"`.
       * Identifies the test-runner invocation the gate accepted as
       * proof of completion.
       */
      test_pass_evidence?: {
        runner: string;
        command: string;
        recorded_at: string;
      };
    } }
  | { type: typeof EventType.TaskFailed; content: {
      task_id: string;
      task_title?: string;
      reason?: string;
      duration_ms?: number;
      phase?: string;
      build_fix_attempts?: number;
    } }
  | { type: typeof EventType.TaskRetrying; content: {
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
  | { type: typeof EventType.TaskBecameReady; content: { task_id: string } }
  | { type: typeof EventType.TasksBecameReady; content: {
      task_ids: string[];
    } }
  | { type: typeof EventType.FollowUpTaskCreated; content: {
      task_id: string;
    } }
  | { type: typeof EventType.FileOpsApplied; content: {
      task_id: string;
      files: { op: string; path: string }[];
      files_written?: number;
      files_deleted?: number;
    } }
  | { type: typeof EventType.TaskCompletionGate; content: {
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
  | { type: typeof EventType.LoopStarted; content: {
      automaton_id?: string;
    } }
  | { type: typeof EventType.LoopPaused; content: {
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
  | { type: typeof EventType.LoopResumed; content: {
      task_id?: string;
      reason?: string;
      retry_kind?: string;
    } }
  | { type: typeof EventType.LoopStopped; content: {
      completed_count?: number;
      tasks_completed?: number;
      tasks_failed?: number;
      total_duration_ms?: number;
      total_cost_usd?: number;
    } }
  | { type: typeof EventType.LoopFinished; content: {
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
  | { type: typeof EventType.LoopIterationSummary; content: {
      task_id?: string;
      phase_timings?: PhaseTimingEntry[];
      duration_ms?: number;
    } }

  // ── Typed loop activity (LoopRegistry) ─────────────────────
  | { type: typeof EventType.LoopOpened; content: {
      loop_id: LoopIdPayload;
      activity: LoopActivityPayload;
    } }
  | { type: typeof EventType.LoopActivityChanged; content: {
      loop_id: LoopIdPayload;
      activity: LoopActivityPayload;
    } }
  | { type: typeof EventType.LoopEnded; content: {
      loop_id: LoopIdPayload;
      activity: LoopActivityPayload;
    } }
  | { type: typeof EventType.SessionRolledOver; content: {
      old_session_id: string;
      new_session_id: string;
      task_id?: string;
      context_usage_pct?: number;
      summary_duration_ms?: number;
    } };
