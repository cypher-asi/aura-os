/**
 * Auto-generated from `aura-protocol` Rust crate via ts-rs.
 *
 * Regenerate with: `npm run codegen:protocol` (from `frontend/`)
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

export interface SessionInit {
  system_prompt?: string | null;
  model?: string | null;
  max_tokens?: number | null;
  temperature?: number | null;
  max_turns?: number | null;
  installed_tools?: InstalledTool[] | null;
  workspace?: string | null;
  token?: string | null;
  project_id?: string | null;
  conversation_messages?: ConversationMessage[] | null;
}

export interface UserMessage {
  content: string;
  tool_hints?: string[] | null;
}

export interface ApprovalResponse {
  tool_use_id: string;
  approved: boolean;
}

export type InboundMessage =
  | { type: "session_init" } & SessionInit
  | { type: "user_message" } & UserMessage
  | { type: "cancel" }
  | { type: "approval_response" } & ApprovalResponse;

// ============================================================================
// Outbound Messages (Server → Client)
// ============================================================================

export interface ToolInfo {
  name: string;
  description: string;
}

export interface SessionReady {
  session_id: string;
  tools: ToolInfo[];
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
  context_utilization: number;
  model: string;
  provider: string;
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

export type OutboundMessage =
  | { type: "session_ready" } & SessionReady
  | { type: "assistant_message_start" } & AssistantMessageStart
  | { type: "text_delta" } & TextDelta
  | { type: "thinking_delta" } & ThinkingDelta
  | { type: "tool_use_start" } & ToolUseStart
  | { type: "tool_result" } & ToolResultMsg
  | { type: "assistant_message_end" } & AssistantMessageEnd
  | { type: "error" } & ErrorMsg;
