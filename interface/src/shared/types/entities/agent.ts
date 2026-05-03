import type {
  AgentId,
  AgentInstanceId,
  ProjectId,
  TaskId,
  SessionId,
} from "../ids";
import type {
  AgentStatus,
  OrchestrationStatus,
  StepStatus,
} from "../enums";
import type {
  AgentPermissions,
  IntentClassifierSpec,
} from "../permissions-wire";

export interface Agent {
  agent_id: AgentId;
  user_id: string;
  org_id?: string | null;
  name: string;
  role: string;
  personality: string;
  system_prompt: string;
  skills: string[];
  icon: string | null;
  machine_type: string;
  adapter_type: string;
  environment: string;
  auth_source: string;
  integration_id?: string | null;
  default_model?: string | null;
  vm_id?: string | null;
  network_agent_id?: string;
  profile_id?: string;
  tags: string[];
  is_pinned: boolean;
  /**
   * Marketplace listing status. Absent on records produced before Phase 3;
   * consumers should treat `undefined` as `"closed"`.
   */
  listing_status?: "closed" | "hireable";
  /** Marketplace expertise slugs; see `MARKETPLACE_EXPERTISE`. */
  expertise?: string[];
  /** Aggregated marketplace stats (computed server-side). */
  jobs?: number;
  revenue_usd?: number;
  reputation?: number;
  /**
   * Local-only override for the agent's working directory, applied only when
   * the agent runs on a local machine. Takes precedence over the project's
   * `local_workspace_path` when both are set.
   */
  local_workspace_path?: string | null;
  /**
   * Required capability + scope bundle. The harness enforces these
   * unconditionally on every session — there is no role-based fallback.
   * Ordinary agents may carry full-access permissions; use
   * `isSuperAgent(agent)` from `@/types/permissions` to detect the explicit
   * CEO bootstrap identity, and use capability helpers for capability checks.
   */
  permissions: AgentPermissions;
  /**
   * Optional per-turn intent classifier. When present the harness narrows
   * the per-turn tool surface based on each user message. Populated for
   * CEO-style agents; `null`/absent for regular agents.
   */
  intent_classifier?: IntentClassifierSpec | null;
  created_at: string;
  updated_at: string;
}

/**
 * Functional role this `AgentInstance` plays inside its project. The
 * upstream harness gates "one in-flight turn per agent_id", so a single
 * instance cannot service chat, an automation loop, and an ad-hoc task
 * simultaneously. The multi-instance concurrency model partitions work
 * across:
 *
 * - `chat`: the default target for the main chat surface,
 * - `loop`: the default target for the project's automation loop,
 * - `executor`: an ephemeral instance allocated per ad-hoc task run.
 *
 * Defaults to `chat` for legacy rows that pre-date this field, matching
 * their existing routing to the chat surface.
 */
export type AgentInstanceRole = "chat" | "loop" | "executor";

export interface AgentInstance {
  agent_instance_id: AgentInstanceId;
  project_id: ProjectId;
  agent_id: AgentId;
  org_id?: string | null;
  name: string;
  role: string;
  personality: string;
  system_prompt: string;
  skills: string[];
  icon: string | null;
  machine_type: string;
  adapter_type: string;
  environment: string;
  auth_source?: string;
  integration_id?: string | null;
  default_model?: string | null;
  workspace_path?: string | null;
  status: AgentStatus;
  current_task_id: TaskId | null;
  current_session_id: SessionId | null;
  /** See {@link AgentInstanceRole}. Optional on the wire so older
   *  backends without the column round-trip cleanly; consumers should
   *  treat `undefined` as `"chat"`. */
  instance_role?: AgentInstanceRole;
  total_input_tokens: number;
  total_output_tokens: number;
  model?: string;
  permissions: AgentPermissions;
  intent_classifier?: IntentClassifierSpec | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRuntimeTestResult {
  ok: boolean;
  adapter_type: string;
  environment: string;
  auth_source: string;
  provider?: string | null;
  model?: string | null;
  integration_id?: string | null;
  integration_name?: string | null;
  message: string;
}

export interface AgentOrchestration {
  orchestration_id: string;
  agent_id: string;
  org_id: string;
  intent: string;
  plan: AgentOrchestrationStep[];
  status: OrchestrationStatus;
  created_at: string;
  updated_at: string;
}

export interface AgentOrchestrationStep {
  step_index: number;
  tool_name: string;
  tool_input: unknown;
  status: StepStatus;
  result: unknown | null;
}
