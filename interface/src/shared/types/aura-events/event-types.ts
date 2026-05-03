import type { Sender } from "./payloads";
import type { DomainEventVariant } from "./events-domain";
import type { SystemEventVariant } from "./events-system";

/* ── EventType enum ─────────────────────────────────────────────────
 * Single source of truth — maps 1:1 with the backend DB enum.
 * String values are the wire/storage format.
 * ------------------------------------------------------------------ */

export const EventType = {
  // Message lifecycle
  UserMessage:           "user_message",
  MessageStart:          "message_start",
  MessageEnd:            "message_end",

  // Streaming (within MessageStart..MessageEnd)
  Delta:                 "delta",
  ThinkingDelta:         "thinking_delta",
  Progress:              "progress",
  ToolCallStarted:       "tool_call_started",
  ToolCallSnapshot:      "tool_call_snapshot",
  ToolCall:              "tool_call",
  ToolResult:            "tool_result",
  /**
   * Emitted by aura-harness (see `AgentLoopEvent::ToolCallRetrying`
   * in crates/aura-agent/src/events/mod.rs) when its internal
   * streaming-retry-with-backoff loop is about to re-request the
   * current `tool_use` from the provider. The UI uses this to
   * render a live "Write retrying (n/8)..." state on the tool card
   * that owns the `tool_use_id`.
   */
  ToolCallRetrying:      "tool_call_retrying",
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
  ToolCallFailed:        "tool_call_failed",
  TokenUsage:            "token_usage",
  Done:                  "done",

  // Harness protocol (local harness wire format)
  SessionReady:              "session_ready",
  AssistantMessageStart:     "assistant_message_start",
  AssistantMessageEnd:       "assistant_message_end",
  TextDelta:                 "text_delta",
  ToolUseStart:              "tool_use_start",

  /**
   * Throttled live-progress heartbeat published by
   * `spawn_chat_persist_task` on the backend every
   * ~`ASSISTANT_TURN_PROGRESS_THROTTLE` ms while an assistant turn is
   * still streaming. Carries no payload beyond the routing keys
   * (`session_id`, `project_id`, `agent_instance_id`,
   * `message_id`). The client uses it to debounce-refetch the
   * persisted chat history so a mid-turn page refresh keeps showing
   * the partial response (text + tool cards + sidekick `pending-*`
   * placeholders) until `assistant_message_end` finally lands.
   */
  AssistantTurnProgress:     "assistant_turn_progress",

  // Agent state
  AgentInstanceUpdated:      "agent_instance_updated",
  RemoteAgentStateChanged:   "remote_agent_state_changed",

  // Spec generation
  SpecSaved:             "spec_saved",
  SpecsTitle:            "specs_title",
  SpecsSummary:          "specs_summary",
  SpecGenStarted:        "spec_gen_started",
  SpecGenProgress:       "spec_gen_progress",
  SpecGenCompleted:      "spec_gen_completed",
  SpecGenFailed:         "spec_gen_failed",
  SpecGenerating:        "generating",
  SpecGenComplete:       "complete",

  // Task lifecycle
  TaskSaved:             "task_saved",
  TaskStarted:           "task_started",
  TaskCompleted:         "task_completed",
  TaskFailed:            "task_failed",
  TaskRetrying:          "task_retrying",
  TaskBecameReady:       "task_became_ready",
  TasksBecameReady:      "tasks_became_ready",
  FollowUpTaskCreated:   "follow_up_task_created",
  FileOpsApplied:        "file_ops_applied",
  /**
   * Audit event emitted by the server's Definition-of-Done gate after a
   * `task_completed` is inspected (see `completion_validation_failure_reason`
   * in `aura-os-server/src/handlers/dev_loop.rs`). `passed === false`
   * indicates the server rewrote the event into `task_failed` because the
   * run lacked required evidence (empty-path writes, no build, no test,
   * etc.). Carries `failure_reason` + the gate report counters.
   */
  TaskCompletionGate:    "task_completion_gate",

  // Loop lifecycle
  LoopStarted:           "loop_started",
  LoopPaused:            "loop_paused",
  LoopResumed:           "loop_resumed",
  LoopStopped:           "loop_stopped",
  LoopFinished:          "loop_finished",
  LoopIterationSummary:  "loop_iteration_summary",
  SessionRolledOver:     "session_rolled_over",

  /**
   * Typed loop lifecycle / activity events emitted by the `LoopRegistry`
   * (backend: `aura_os_events::DomainEvent::LoopOpened` /
   * `LoopActivityChanged` / `LoopEnded`). These carry structured
   * `loop_id` + `activity` payloads that feed the unified circular
   * progress indicator in the agent list, sidekick tabs, and task rows.
   * They coexist with the string-keyed `LoopStarted`/`LoopFinished`
   * events above for backwards compatibility.
   */
  LoopOpened:            "loop_opened",
  LoopActivityChanged:   "loop_activity_changed",
  LoopEnded:             "loop_ended",

  // Build verification
  BuildVerificationSkipped:  "build_verification_skipped",
  BuildVerificationStarted:  "build_verification_started",
  BuildVerificationPassed:   "build_verification_passed",
  BuildVerificationFailed:   "build_verification_failed",
  BuildFixAttempt:           "build_fix_attempt",

  // Test verification
  TestVerificationStarted:   "test_verification_started",
  TestVerificationPassed:    "test_verification_passed",
  TestVerificationFailed:    "test_verification_failed",
  TestFixAttempt:            "test_fix_attempt",

  // Git
  GitCommitted:          "git_committed",
  GitCommitFailed:       "git_commit_failed",
  /**
   * Emitted when the DoD completion gate rejects a task *after* the
   * automaton already reported `git_committed`. The SHA carried in
   * the event cannot be reached from `git log` (the push was never
   * made, and the commit is effectively orphaned). The UI renders
   * this as a muted/strikethrough row so users are not misled by a
   * committed-looking SHA that does not actually exist on main.
   */
  GitCommitRolledBack:   "git_commit_rolled_back",
  GitPushed:             "git_pushed",
  GitPushFailed:         "git_push_failed",
  /**
   * Emitted on every push failure (transient or terminal). Carries
   * the task/project context and the classified failure reason so
   * the UI can surface a muted "Push deferred" row on the task card
   * without the red "push_failed" styling.
   */
  PushDeferred:          "push_deferred",
  /**
   * Emitted ONCE per streak when a project accumulates
   * CONSECUTIVE_PUSH_FAILURES_STUCK_THRESHOLD back-to-back push
   * failures. The UI uses this as a signal to mount a persistent
   * banner on the project header until a successful push clears it.
   */
  ProjectPushStuck:      "project_push_stuck",

  // Billing
  CreditBalanceUpdated:  "credit_balance_updated",

  // Process execution
  ProcessRunStarted:     "process_run_started",
  ProcessRunProgress:    "process_run_progress",
  ProcessRunCompleted:   "process_run_completed",
  ProcessRunFailed:      "process_run_failed",
  ProcessNodeExecuted:   "process_node_executed",
  ProcessNodeOutputDelta: "process_node_output_delta",

  // Generation (image / 3D)
  GenerationStart:       "generation_start",
  GenerationProgress:    "generation_progress",
  GenerationPartialImage: "generation_partial_image",
  GenerationCompleted:   "generation_completed",
  GenerationError:       "generation_error",

  // Other
  LogLine:               "log_line",
  NetworkEvent:          "network_event",
  Error:                 "error",
} as const;
export type EventType = typeof EventType[keyof typeof EventType];

/* ── AuraEventBase ─────────────────────────────────────────────────
 * Mirrors the `session_events` table columns.
 * ------------------------------------------------------------------ */

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
 * shape depends on the type — mirroring the DB's JSONB column. The
 * variants live in `events-domain.ts` and `events-system.ts`; this
 * file just composes them.
 * ------------------------------------------------------------------ */

export type AuraEvent = AuraEventBase & (DomainEventVariant | SystemEventVariant);
