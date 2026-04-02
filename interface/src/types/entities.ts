import type { ProjectId, SpecId, TaskId, AgentId, AgentInstanceId, SessionId, SessionEventId } from "./ids";
import type {
  ProjectStatus,
  TaskStatus,
  AgentStatus,
  SessionStatus,
  OrchestrationStatus,
  StepStatus,
  CronJobRunStatus,
  CronJobTrigger,
  ArtifactType,
  ProcessNodeType,
  ProcessRunStatus,
  ProcessRunTrigger,
  ProcessEventStatus,
} from "./enums";

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
  machine_type: string;
  vm_id?: string | null;
  network_agent_id?: string;
  profile_id?: string;
  tags: string[];
  is_pinned: boolean;
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
  machine_type: string;
  workspace_path?: string | null;
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

export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; media_type: string; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string;
      is_error?: boolean }
  | { type: "task_ref"; task_id: string; title: string }
  | { type: "spec_ref"; spec_id: string; title: string };

export interface SessionEvent {
  event_id: SessionEventId;
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
  is_zero_pro?: boolean;
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
  is_zero_pro?: boolean;
  zero_pro_refresh_error?: string;
  access_token?: string;
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

export interface CreditBalance {
  balance_cents: number;
  plan: string;
  balance_formatted: string;
}

export interface CreditTransaction {
  id: string;
  amount_cents: number;
  transaction_type: string;
  balance_after_cents: number;
  description: string;
  created_at: string;
}

export interface TransactionsResponse {
  transactions: CreditTransaction[];
  has_more: boolean;
}

export interface BillingAccount {
  user_id: string;
  balance_cents: number;
  balance_formatted: string;
  lifetime_purchased_cents: number;
  lifetime_granted_cents: number;
  lifetime_used_cents: number;
  plan: string;
  auto_refill_enabled: boolean;
  created_at: string;
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

export interface EnvironmentInfo {
  os: string;
  architecture: string;
  hostname: string;
  ip: string;
  cwd: string;
}

export interface RemoteVmState {
  state: string
  uptime_seconds: number
  active_sessions: number
  last_heartbeat_at?: string
  error_message?: string
  agent_id?: string
  name?: string
  cpu_millicores?: number
  memory_mb?: number
  runtime_version?: string
  isolation?: string
  endpoint?: string
  created_at?: string
}

export interface SuperAgentOrchestration {
  orchestration_id: string;
  agent_id: string;
  org_id: string;
  intent: string;
  plan: SuperAgentStep[];
  status: OrchestrationStatus;
  created_at: string;
  updated_at: string;
}

export interface SuperAgentStep {
  step_index: number;
  tool_name: string;
  tool_input: unknown;
  status: StepStatus;
  result: unknown | null;
}

export interface ApiError {
  error: string;
  code: string;
  details: string | null;
}

export interface ArtifactRef {
  source_cron_job_id: string;
  artifact_type?: ArtifactType;
  use_latest: boolean;
  specific_run_id?: string;
}

export interface CronTag {
  tag_id: string;
  org_id: string;
  name: string;
  created_at: string;
}

export interface CronJob {
  cron_job_id: string;
  org_id: string;
  user_id: string;
  name: string;
  description: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  agent_id: string | null;
  tags: string[];
  input_artifact_refs: ArtifactRef[];
  max_retries: number;
  timeout_seconds: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CronJobRun {
  run_id: string;
  cron_job_id: string;
  status: CronJobRunStatus;
  trigger: CronJobTrigger;
  prompt_snapshot: string;
  response_text: string;
  output_artifact_ids: string[];
  tasks_created: string[];
  error: string | null;
  input_tokens: number;
  output_tokens: number;
  started_at: string;
  completed_at: string | null;
}

export interface CronArtifact {
  artifact_id: string;
  cron_job_id: string;
  run_id: string;
  org_id: string;
  artifact_type: ArtifactType;
  name: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  expires_at: string | null;
}

// ---------------------------------------------------------------------------
// Process workflow entities
// ---------------------------------------------------------------------------

export interface ProcessFolder {
  folder_id: string;
  org_id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Process {
  process_id: string;
  org_id: string;
  user_id: string;
  name: string;
  description: string;
  enabled: boolean;
  folder_id: string | null;
  schedule: string | null;
  tags: string[];
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcessNode {
  node_id: string;
  process_id: string;
  node_type: ProcessNodeType;
  label: string;
  agent_id: string | null;
  prompt: string;
  config: Record<string, unknown>;
  position_x: number;
  position_y: number;
  created_at: string;
  updated_at: string;
}

export interface ProcessNodeConnection {
  connection_id: string;
  process_id: string;
  source_node_id: string;
  source_handle: string | null;
  target_node_id: string;
  target_handle: string | null;
}

export interface ProcessRun {
  run_id: string;
  process_id: string;
  status: ProcessRunStatus;
  trigger: ProcessRunTrigger;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface ProcessEvent {
  event_id: string;
  run_id: string;
  node_id: string;
  process_id: string;
  status: ProcessEventStatus;
  input_snapshot: string;
  output: string;
  started_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Memory entities (harness API)
// ---------------------------------------------------------------------------

export interface MemoryFact {
  fact_id: string;
  agent_id: string;
  key: string;
  value: any;
  confidence: number;
  source: "extracted" | "user_provided" | "consolidated";
  importance: number;
  access_count: number;
  last_accessed: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryEvent {
  event_id: string;
  agent_id: string;
  event_type: string;
  summary: string;
  metadata: any;
  importance: number;
  access_count: number;
  last_accessed: string;
  timestamp: string;
}

export interface MemoryProcedure {
  procedure_id: string;
  agent_id: string;
  name: string;
  trigger: string;
  steps: string[];
  context_constraints: any;
  success_rate: number;
  execution_count: number;
  last_used: string;
  created_at: string;
  updated_at: string;
}

export interface MemorySnapshot {
  facts: MemoryFact[];
  events: MemoryEvent[];
  procedures: MemoryProcedure[];
}

export interface MemoryStats {
  facts: number;
  events: number;
  procedures: number;
}

// ---------------------------------------------------------------------------
// Harness skill entities
// ---------------------------------------------------------------------------

export interface HarnessSkill {
  name: string;
  description: string;
  source: string;
  model_invocable: boolean;
  user_invocable: boolean;
  body?: string;
  supporting_files?: string[];
  frontmatter: Record<string, any>;
}

export interface HarnessSkillActivation {
  rendered_content: string;
  allowed_tools: string[];
  fork_context: boolean;
}

export interface HarnessSkillInstallation {
  agent_id: string;
  skill_name: string;
  source_url: string | null;
  installed_at: string;
  version: string | null;
}

// ---------------------------------------------------------------------------
// Skill Store catalog
// ---------------------------------------------------------------------------

export type SkillCategory =
  | "development"
  | "communication"
  | "productivity"
  | "media"
  | "ai-ml"
  | "smart-home"
  | "security"
  | "notes"
  | "automation"
  | "utilities";

export interface SkillStoreCatalogEntry {
  name: string;
  description: string;
  emoji: string;
  category: SkillCategory;
  tags: string[];
  security_rating: "safe" | "caution" | "warning";
  security_notes: string;
  source_url: string;
  requires?: { bins?: string[]; env?: string[]; config?: string[] };
  install_methods?: { kind: string; formula?: string; package?: string }[];
}
