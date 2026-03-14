export type EngineEventType =
  | "loop_started"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_retrying"
  | "task_became_ready"
  | "task_output_delta"
  | "file_ops_applied"
  | "follow_up_task_created"
  | "session_rolled_over"
  | "loop_paused"
  | "loop_stopped"
  | "loop_finished"
  | "log_line"
  | "spec_gen_started"
  | "spec_gen_progress"
  | "spec_gen_completed"
  | "spec_gen_failed"
  | "spec_saved"
  | "build_verification_started"
  | "build_verification_passed"
  | "build_verification_failed"
  | "build_fix_attempt";

export interface EngineEvent {
  type: EngineEventType;
  task_id?: string;
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
  agent_id?: string;
  stage?: string;
  spec_count?: number;
  spec?: import("./entities").Spec;
  command?: string;
  stderr?: string;
  stdout?: string;
}
