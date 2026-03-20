export type EngineEventType =
  | "loop_started"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_retrying"
  | "task_became_ready"
  | "tasks_became_ready"
  | "task_output_delta"
  | "file_ops_applied"
  | "follow_up_task_created"
  | "session_rolled_over"
  | "loop_paused"
  | "loop_stopped"
  | "loop_finished"
  | "loop_iteration_summary"
  | "log_line"
  | "spec_gen_started"
  | "spec_gen_progress"
  | "spec_gen_completed"
  | "spec_gen_failed"
  | "spec_saved"
  | "build_verification_skipped"
  | "build_verification_started"
  | "build_verification_passed"
  | "build_verification_failed"
  | "build_fix_attempt"
  | "test_verification_started"
  | "test_verification_passed"
  | "test_verification_failed"
  | "test_fix_attempt"
  | "network_event";

export interface PhaseTimingEntry {
  phase: string;
  duration_ms: number;
}

export interface EngineEvent {
  type: EngineEventType;
  task_id?: string;
  task_ids?: string[];
  task_title?: string;
  session_id?: string;
  delta?: string;
  reason?: string;
  attempt?: number;
  old_session_id?: string;
  new_session_id?: string;
  completed_count?: number;
  outcome?: string;
  execution_notes?: string;
  files_written?: number;
  files_deleted?: number;
  files?: { op: string; path: string }[];
  message?: string;
  project_id?: string;
  agent_instance_id?: string;
  stage?: string;
  spec_count?: number;
  spec?: import("./entities").Spec;
  command?: string;
  stderr?: string;
  stdout?: string;
  tests?: { name: string; status: string; message?: string }[];
  summary?: string;

  // Observability: timing
  duration_ms?: number;
  llm_duration_ms?: number;
  build_verify_duration_ms?: number;
  summary_duration_ms?: number;
  total_duration_ms?: number;

  // Observability: token counts & cost
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_estimate?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  cost_usd?: number;
  total_cost_usd?: number;

  // Observability: codebase snapshot
  codebase_snapshot_bytes?: number;
  codebase_file_count?: number;

  // Observability: quality signals
  files_changed_count?: number;
  parse_retries?: number;
  build_fix_attempts?: number;
  model?: string;
  phase?: string;
  error_hash?: string;
  context_usage_pct?: number;

  // Observability: loop-level metrics
  tasks_completed?: number;
  tasks_failed?: number;
  tasks_retried?: number;
  sessions_used?: number;
  total_parse_retries?: number;
  total_build_fix_attempts?: number;
  duplicate_error_bailouts?: number;

  // Observability: iteration summary
  phase_timings?: PhaseTimingEntry[];

  // Network events (bridged from aura-network WebSocket)
  network_event_type?: string;
  payload?: Record<string, unknown>;
}
