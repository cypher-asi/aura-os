import type { ProjectId, SpecId, TaskId, AgentId, SessionId } from "./ids";
import type {
  ProjectStatus,
  TaskStatus,
  AgentStatus,
  SessionStatus,
  ApiKeyStatus,
} from "./enums";

export interface Project {
  project_id: ProjectId;
  name: string;
  description: string;
  linked_folder_path: string;
  requirements_doc_path: string;
  current_status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Spec {
  spec_id: SpecId;
  project_id: ProjectId;
  title: string;
  order_index: number;
  markdown_contents: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  task_id: TaskId;
  project_id: ProjectId;
  spec_id: SpecId;
  title: string;
  description: string;
  status: TaskStatus;
  order_index: number;
  dependency_ids: TaskId[];
  assigned_agent_id: AgentId | null;
  execution_notes: string;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  agent_id: AgentId;
  project_id: ProjectId;
  name: string;
  status: AgentStatus;
  current_task_id: TaskId | null;
  current_session_id: SessionId | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  session_id: SessionId;
  agent_id: AgentId;
  project_id: ProjectId;
  active_task_id: TaskId | null;
  context_usage_estimate: number;
  summary_of_previous_context: string;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
}

export interface ApiKeyInfo {
  status: ApiKeyStatus;
  masked_key: string | null;
  last_validated_at: string | null;
  updated_at: string | null;
}

export interface ProjectProgress {
  project_id: ProjectId;
  total_tasks: number;
  pending_tasks: number;
  ready_tasks: number;
  in_progress_tasks: number;
  blocked_tasks: number;
  done_tasks: number;
  failed_tasks: number;
  completion_percentage: number;
}

export interface ChatSession {
  chat_session_id: string;
  project_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  message_id: string;
  chat_session_id: string;
  project_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface ApiError {
  error: string;
  code: string;
  details: string | null;
}
