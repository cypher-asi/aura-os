export type EngineEventType =
  | "loop_started"
  | "task_started"
  | "task_completed"
  | "task_failed"
  | "task_became_ready"
  | "follow_up_task_created"
  | "session_rolled_over"
  | "loop_paused"
  | "loop_stopped"
  | "loop_finished"
  | "log_line";

export interface EngineEvent {
  type: EngineEventType;
  task_id?: string;
  task_title?: string;
  reason?: string;
  old_session_id?: string;
  new_session_id?: string;
  completed_count?: number;
  outcome?: string;
  message?: string;
  project_id?: string;
  agent_id?: string;
}
