import type {
  ProjectId,
  SpecId,
  TaskId,
  AgentInstanceId,
  SessionId,
} from "../ids";
import type { ProjectStatus, TaskStatus } from "../enums";

export interface Project {
  project_id: ProjectId;
  org_id: string;
  name: string;
  description: string;
  requirements_doc_path?: string;
  current_status: ProjectStatus;
  build_command?: string;
  test_command?: string;
  specs_summary?: string;
  specs_title?: string;
  created_at: string;
  updated_at: string;
  git_repo_url?: string;
  git_branch?: string;
  orbit_base_url?: string;
  orbit_owner?: string;
  orbit_repo?: string;
  /**
   * Local-only, per-machine override for the project's working directory.
   * Absolute OS path. Never synced to aura-network; local agents and the
   * project terminal default to this folder when set.
   */
  local_workspace_path?: string | null;
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

export interface BuildStepRecord {
  kind: string;
  command?: string;
  stderr?: string;
  stdout?: string;
  attempt?: number;
}

export interface IndividualTestResult {
  name: string;
  status: string;
  message?: string;
}

export interface TestStepRecord {
  kind: string;
  command?: string;
  stderr?: string;
  stdout?: string;
  attempt?: number;
  tests: IndividualTestResult[];
  summary?: string;
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
  parent_task_id: TaskId | null;
  assigned_agent_instance_id: AgentInstanceId | null;
  completed_by_agent_instance_id: AgentInstanceId | null;
  session_id: SessionId | null;
  execution_notes: string;
  files_changed: { op: string; path: string; lines_added?: number; lines_removed?: number }[];
  live_output: string;
  build_steps?: BuildStepRecord[];
  test_steps?: TestStepRecord[];
  user_id?: string;
  model?: string;
  total_input_tokens: number;
  total_output_tokens: number;
  created_at: string;
  updated_at: string;
}
