import type { ProjectId, SpecId, TaskId, AgentId, AgentInstanceId, SessionId, MessageId } from "./ids";
import type {
  ProjectStatus,
  TaskStatus,
  AgentStatus,
  SessionStatus,
} from "./enums";

export interface Project {
  project_id: ProjectId;
  org_id: string;
  name: string;
  description: string;
  linked_folder_path: string;
  workspace_source?: string;
  workspace_display_path?: string;
  requirements_doc_path?: string;
  current_status: ProjectStatus;
  build_command?: string;
  test_command?: string;
  specs_summary?: string;
  specs_title?: string;
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

export interface Agent {
  agent_id: AgentId;
  user_id: string;
  name: string;
  role: string;
  personality: string;
  system_prompt: string;
  skills: string[];
  icon: string | null;
  network_agent_id?: string;
  profile_id?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentInstance {
  agent_instance_id: AgentInstanceId;
  project_id: ProjectId;
  agent_id: AgentId;
  name: string;
  role: string;
  personality: string;
  system_prompt: string;
  skills: string[];
  icon: string | null;
  status: AgentStatus;
  current_task_id: TaskId | null;
  current_session_id: SessionId | null;
  total_input_tokens: number;
  total_output_tokens: number;
  model?: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  session_id: SessionId;
  agent_instance_id: AgentInstanceId;
  project_id: ProjectId;
  active_task_id: TaskId | null;
  tasks_worked: TaskId[];
  context_usage_estimate: number;
  total_input_tokens: number;
  total_output_tokens: number;
  summary_of_previous_context: string;
  status: SessionStatus;
  user_id?: string;
  model?: string;
  started_at: string;
  ended_at: string | null;
}

export interface ApiKeyInfo {
  configured: boolean;
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
  total_tokens: number;
  total_cost: number;
  lines_changed: number;
  lines_of_code: number;
  total_commits: number;
  total_pull_requests: number;
  total_messages: number;
  total_agents: number;
  total_sessions: number;
  total_time_seconds: number;
  total_tests: number;
}

export interface ChatContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image" | "task_ref" | "spec_ref";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  media_type?: string;
  data?: string;
  task_id?: string;
  spec_id?: string;
  title?: string;
}

export interface Message {
  message_id: MessageId;
  agent_instance_id: AgentInstanceId;
  project_id: ProjectId;
  role: "user" | "assistant" | "system";
  content: string;
  content_blocks?: ChatContentBlock[];
  thinking?: string;
  thinking_duration_ms?: number;
  created_at: string;
}

export interface ZeroUser {
  user_id: string;
  network_user_id?: string;
  profile_id?: string;
  display_name: string;
  profile_image: string;
  primary_zid: string;
  zero_wallet: string;
  wallets: string[];
}

export interface AuthSession {
  user_id: string;
  network_user_id?: string;
  profile_id?: string;
  display_name: string;
  profile_image: string;
  primary_zid: string;
  zero_wallet: string;
  wallets: string[];
  created_at: string;
  validated_at: string;
}

export type OrgRole = "owner" | "admin" | "member";
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

export interface Org {
  org_id: string;
  name: string;
  owner_user_id: string;
  slug?: string;
  description?: string;
  avatar_url?: string;
  billing_email?: string;
  billing: OrgBilling | null;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  display_name: string;
  role: OrgRole;
  avatar_url?: string;
  credit_budget?: number;
  joined_at: string;
}

export interface OrgInvite {
  invite_id: string;
  org_id: string;
  token: string;
  created_by: string;
  status: InviteStatus;
  accepted_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface OrgBilling {
  billing_email: string | null;
  plan: string;
}

export interface CreditTier {
  id: string;
  credits: number;
  price_usd_cents: number;
  label: string;
}

export interface CreditPurchase {
  id: string;
  tier_id: string | null;
  credits: number;
  amount_cents: number;
  status: string;
  created_at: string;
}

export interface CreditBalance {
  total_credits: number;
  purchases: CreditPurchase[];
}

export interface CheckoutSessionResponse {
  checkout_url: string;
  session_id: string;
}

export interface DailyCommitActivity {
  date: string;
  count: number;
}

export interface Follow {
  id: string;
  follower_profile_id: string;
  target_profile_id: string;
  created_at: string;
}

export interface ApiError {
  error: string;
  code: string;
  details: string | null;
}
