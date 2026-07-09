/**
 * Auto-generated from `aura-protocol` Rust crate via ts-rs.
 *
 * Regenerate with: `npm run codegen:protocol` (from `interface/`)
 *
 * DO NOT EDIT BY HAND — changes will be overwritten.
 */

// ============================================================================
// Installed Tool Types
// ============================================================================

export type ToolAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "api_key"; header: string; key: string }
  | { type: "headers"; headers: Record<string, string> };

export interface InstalledTool {
  name: string;
  description: string;
  input_schema: unknown;
  endpoint: string;
  auth?: ToolAuth;
  timeout_ms?: number | null;
  namespace?: string | null;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Inbound Messages (Client → Server)
// ============================================================================

export interface ConversationMessage {
  role: string;
  content: string;
}

/**
 * Phase A canonical wire shape for `POST /v1/run`. Replaces the
 * previous `SessionInit` first-frame contract on `/stream`.
 *
 * Mirror of `aura_protocol::RuntimeRequest` in Rust.
 */
export interface RuntimeRequest {
  type: RuntimeRequestType;
  agent_identity: AgentIdentity;
  model: ModelSelection;
  workspace: WorkspaceLocation;
  project?: ProjectContext | null;
  agent_permissions: unknown;
  tool_permissions?: unknown | null;
  agent_capabilities: AgentCapabilities;
  auth_jwt?: string | null;
  user_id: string;
}

export type RuntimeRequestType =
  | { kind: "chat"; params: { conversation_messages: ConversationMessage[] } }
  | { kind: "dev_loop"; params: Record<string, never> }
  | {
      kind: "task_run";
      params: {
        task_id: string;
        prior_failure?: string | null;
        work_log: string[];
      };
    }
  | {
      kind: "council";
      params: {
        members: CouncilMember[];
        conversation_messages: ConversationMessage[];
      };
    };

/**
 * One member of an AURA Council run: a model to fan the shared query
 * out to. `id` is a stable per-member slot id the runtime echoes back
 * on the member's `SubagentSpawned` so the UI can correlate columns.
 *
 * Hand-maintained mirror of the generated
 * `crates/aura-protocol/bindings/CouncilMember.ts`.
 */
export interface CouncilMember {
  id: string;
  model: ModelSelection;
  role: "aggregator" | "reference" | null;
}

export interface AgentIdentity {
  template_id?: string | null;
  partition_id?: string | null;
  persona?: AgentPersona | null;
  skills: string[];
  system_prompt?: string | null;
}

export interface AgentPersona {
  name: string;
  role: string;
  personality: string;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "max";

export interface ModelSelection {
  id?: string | null;
  max_tokens?: number | null;
  max_turns?: number | null;
  temperature?: number | null;
  reasoning_effort?: ReasoningEffort | null;
  provider_overrides?: unknown | null;
}

export interface WorkspaceLocation {
  workspace?: string | null;
  project_path?: string | null;
  git_repo_url?: string | null;
  git_branch?: string | null;
}

export interface ProjectContext {
  project_id: string;
  project_info?: unknown | null;
  aura_org_id?: string | null;
  aura_session_id?: string | null;
  aura_agent_id?: string | null;
}

export interface AgentCapabilities {
  installed_tools: InstalledTool[];
  installed_integrations: unknown[];
  intent_classifier?: unknown | null;
}

export interface RuntimeRunResponse {
  run_id: string;
  event_stream_url: string;
}

export interface MessageAttachment {
  type: "image" | "text";
  media_type: string;
  data: string;
  name?: string;
}

export interface UserMessage {
  content: string;
  tool_hints?: string[] | null;
  attachments?: MessageAttachment[] | null;
}

export interface ApprovalResponse {
  tool_use_id: string;
  approved: boolean;
}

/**
 * Phase A: the harness no longer accepts a `session_init` first WS
 * frame — sessions are created via `POST /v1/run` (body:
 * [`RuntimeRequest`]) and the client then opens `WS /stream/:run_id`,
 * which immediately emits `SessionReady` as the first server-side
 * frame.
 */
export type InboundMessage =
  | ({ type: "user_message" } & UserMessage)
  | { type: "cancel" }
  | ({ type: "approval_response" } & ApprovalResponse);

// ============================================================================
// Outbound Messages (Server → Client)
// ============================================================================

export interface ToolInfo {
  name: string;
  description: string;
}

export interface SkillInfo {
  name: string;
  description: string;
}

export interface SessionReady {
  session_id: string;
  tools: ToolInfo[];
  skills: SkillInfo[];
}

export interface AssistantMessageStart {
  message_id: string;
}

export interface TextDelta {
  text: string;
}

export interface ThinkingDelta {
  thinking: string;
}

export interface ToolUseStart {
  id: string;
  name: string;
}

export interface ToolResultMsg {
  name: string;
  result: string;
  is_error: boolean;
  tool_use_id?: string;
}

export interface SessionUsage {
  input_tokens: number;
  output_tokens: number;
  cumulative_input_tokens: number;
  cumulative_output_tokens: number;
  /**
   * Session-cumulative cache token counts (Anthropic
   * `cache_creation_input_tokens` / `cache_read_input_tokens` summed
   * across turns). Optional because older harness builds omit them; the
   * Session Cost widget treats missing values as 0. Mirrors the
   * `cumulative_cache_*` fields on `aura-protocol`'s `SessionUsage`.
   */
  cumulative_cache_read_input_tokens?: number;
  cumulative_cache_creation_input_tokens?: number;
  context_utilization: number;
  model: string;
  provider: string;
  /**
   * Per-bucket token estimates that approximately sum to
   * `estimated_context_tokens`. Optional because older harness builds
   * omit it; the frontend treats an absent or all-zero breakdown as
   * "not available" and falls back to the legacy used/total view.
   */
  context_breakdown?: ContextBreakdown;
  /**
   * Rendered text the harness counted for each static context bucket,
   * fetched lazily when a user opens a bucket in the Context
   * Composition popover. Optional because older harness builds omit
   * it; the frontend treats a missing/empty value as "content not
   * available from this harness build yet".
   */
  context_contents?: ContextContents;
}

/**
 * Per-bucket context-window token estimates emitted by the harness.
 * `mcp_tokens` is reserved (always 0 today) for future MCP integration.
 */
export interface ContextBreakdown {
  system_prompt_tokens: number;
  tools_tokens: number;
  skills_tokens: number;
  mcp_tokens: number;
  subagents_tokens: number;
  conversation_tokens: number;
  /**
   * Tokens served from the upstream provider's prompt cache during the
   * most recent turn (Anthropic `cache_read_input_tokens` or OpenAI/xAI
   * `prompt_tokens_details.cached_tokens`). Describes what fraction of
   * the *conversation* bucket was a cache hit; the popover renders
   * this as a "Cached this turn" sub-row, not as a separate bucket.
   */
  cache_read_tokens?: number;
  /**
   * Tokens written to the upstream provider's prompt cache during the
   * most recent turn (Anthropic `cache_creation_input_tokens` or
   * OpenAI/xAI cache-miss input).
   */
  cache_creation_tokens?: number;
}

/**
 * One rendered entry inside a context bucket (e.g. a single tool
 * definition or skill). Named `ContextSegment` rather than `Item` per
 * the naming rule, kept identical across Rust + TS for the binding.
 */
export interface ContextSegment {
  label: string;
  text: string;
  tokens: number;
}

/**
 * Rendered text the harness counted for each static context bucket.
 * All fields optional/defaulted so older harness builds decode to an
 * empty value rather than failing (mirrors {@link ContextBreakdown}).
 */
export interface ContextContents {
  system_prompt?: string | null;
  tools?: ContextSegment[];
  skills?: ContextSegment[];
  subagents?: ContextSegment[];
  mcp?: ContextSegment[];
}

export interface FileOp {
  path: string;
  operation: string;
}

export interface FilesChanged {
  created: string[];
  modified: string[];
  deleted: string[];
}

export interface AssistantMessageEnd {
  message_id: string;
  stop_reason: string;
  usage: SessionUsage;
  files_changed: FilesChanged;
}

export interface ErrorMsg {
  code: string;
  message: string;
  recoverable: boolean;
}

/**
 * Terminal/transitional lifecycle states a spawned subagent run can be
 * in. Mirrors the `state` field on the backend `subagent_status` event
 * (`aura-protocol` `SubagentStatus`). Kept as a string-literal union so
 * the UI status pill can switch exhaustively without an enum.
 */
export type SubagentState =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"
  | "rejected";

/**
 * `subagent_spawned` — announces a child subagent run on the parent
 * stream. `child_run_id` is the run id the client attaches to via
 * `POST /api/streams/subagents/:child_run_id/attach`;
 * `parent_tool_use_id` ties the thread back to the originating `task`
 * tool-use block so the UI can render the live thread under that card.
 *
 * Hand-maintained mirror of the generated
 * `crates/aura-protocol/bindings/SubagentSpawned.ts`.
 */
export interface SubagentSpawned {
  child_run_id: string;
  parent_tool_use_id: string | null;
  subagent_type: string;
  prompt: string;
  /**
   * Model id driving this child run. Set for AURA Council members so the
   * UI can label each column; `null` for ordinary `task` spawns.
   */
  model?: string | null;
  /**
   * Zero-based council slot index for AURA Council members (ordering the
   * columns); `null` for ordinary `task` spawns.
   */
  council_index?: number | null;
  /**
   * Council combine mechanism (`synthesize` / `contrast` /
   * `side_by_side`) shared by every member of the turn; `null` for
   * ordinary `task` spawns.
   */
  council_mechanism?: string | null;
}

/**
 * `subagent_status` — most recent lifecycle state for a spawned child
 * run. `reason` carries the failure/rejection detail when applicable
 * (depth/quota rejections surface here).
 *
 * Hand-maintained mirror of the generated
 * `crates/aura-protocol/bindings/SubagentStatus.ts` (the generated
 * `state` is a bare `string`; we narrow it to {@link SubagentState}).
 */
export interface SubagentStatus {
  child_run_id: string;
  state: SubagentState;
  reason: string | null;
}

export type OutboundMessage =
  | { type: "session_ready" } & SessionReady
  | { type: "assistant_message_start" } & AssistantMessageStart
  | { type: "text_delta" } & TextDelta
  | { type: "thinking_delta" } & ThinkingDelta
  | { type: "tool_use_start" } & ToolUseStart
  | { type: "tool_result" } & ToolResultMsg
  | { type: "assistant_message_end" } & AssistantMessageEnd
  | { type: "subagent_spawned" } & SubagentSpawned
  | { type: "subagent_status" } & SubagentStatus
  | { type: "error" } & ErrorMsg;
