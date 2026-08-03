import type {
  ProjectId,
  AgentId,
  AgentInstanceId,
  Agent,
  AgentInstance,
  AgentInstanceSource,
  AgentPermissions,
  IntentClassifierSpec,
  Session,
  SessionEvent,
  Task,
  AgentOrchestration,
} from "../types";
import { apiFetch } from "./core";
import { sendAgentEventStream, sendEventStream } from "../../api/streams";
import type { WireContextBreakdown } from "../../stores/context-usage-store";
import type { WireContextContents } from "../../stores/context-contents-store";

type ApiRequestOptions = {
  signal?: AbortSignal;
};

export const STANDALONE_AGENT_HISTORY_LIMIT = 80;
// Starts before `fetch`, so it also bounds WebKit connection-pool queueing.
// Keep slightly above the server's 12-second Recall wall-clock budget.
const RECALL_SEARCH_TIMEOUT_MS = 15_000;

interface AgentEventsRequestOptions extends ApiRequestOptions {
  limit?: number;
  offset?: number;
}

interface AgentSessionEventsRequestOptions extends ApiRequestOptions {
  limit?: number;
  /** RFC 3339 timestamp; only events with `created_at > since` are returned. */
  since?: string;
}

export interface PaginatedEventsResponse {
  events: SessionEvent[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface PaginatedSessionEventsRequestOptions extends ApiRequestOptions {
  /** Page size (server default 100, max 400). */
  limit?: number;
  /** `event_id` cursor: return the page of messages immediately before it. */
  before?: string;
}

/** A short, source-linked excerpt from the current user's completed chats. */
export interface RecallSearchResult {
  eventId: string;
  sessionId: string;
  projectId: ProjectId;
  agentInstanceId: AgentInstanceId;
  agentId: AgentId;
  occurredAt: string;
  role: "user" | "assistant";
  snippet: string;
}

export interface RecallSearchResponse {
  results: RecallSearchResult[];
  scannedSessions: number;
  skippedSessions: number;
}

export interface SafeWorkspaceCheckpoint {
  id: string;
  shortId: string;
  createdAt: string;
  reason: string;
}

export interface SafeWorkspaceStatus {
  enabled: boolean;
  workspacePath: string | null;
  sourcePath: string | null;
  baseCommit: string | null;
  createdAt: string | null;
  checkpoints: SafeWorkspaceCheckpoint[];
}

export interface SafeWorkspaceEligibility {
  available: boolean;
}

export interface SafeWorkspaceDiff {
  checkpointId: string;
  stat: string;
  diff: string;
  truncated: boolean;
}

export interface SafeWorkspaceRestoreResult {
  restoredTo: string;
  undoCheckpointId: string;
  workspacePath: string;
}

export interface SafeWorkspaceApplyResult {
  applied: boolean;
  checkpointId: string;
  stat: string;
  sourcePath: string;
}

function paginatedEventsQuery(options?: PaginatedSessionEventsRequestOptions): string {
  const params = new URLSearchParams();
  if (options?.limit != null) {
    params.set("limit", String(options.limit));
  }
  if (options?.before) {
    params.set("before", options.before);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export interface ContextUsageResponse {
  context_utilization: number;
  /** Most recent absolute token count for the session's input context,
   * as reported by the harness in `assistant_message_end.usage`. Absent
   * when only the legacy `context_utilization` ratio is known (e.g.
   * dev-loop fallback). */
  estimated_context_tokens?: number;
  /** Per-bucket token estimates from the most recent persisted
   * `assistant_message_end` event for the session. Absent on older
   * harness builds (or when every bucket was zero); the frontend treats
   * an absent breakdown as "not available" and falls back to the legacy
   * two-row Used/Total card in `ContextUsageIndicator`. Plumbed through
   * `useHydrateContextUtilization` so the new stacked-bar popover
   * renders immediately on chat mount instead of waiting for the next
   * assistant turn. */
  context_breakdown?: WireContextBreakdown;
  /** Session-cumulative token counts and the model/provider that
   * produced them, mirrored from `assistant_message_end.usage`. Plumbed
   * through `useHydrateContextUtilization` so the Session Cost section of
   * the Context popover survives a page reload instead of waiting for the
   * next assistant turn. All optional: older harness builds omit them and
   * the frontend simply hides the Session Cost section. */
  cumulative_input_tokens?: number;
  cumulative_output_tokens?: number;
  cumulative_cache_read_input_tokens?: number;
  cumulative_cache_creation_input_tokens?: number;
  model?: string;
  provider?: string;
}

/**
 * Response for the lazy `context-contents` endpoints. Mirrors the
 * server's `ContextContentsResponse` struct: a single optional
 * `context_contents` field that is omitted entirely (rather than
 * serialized as `null`) when no qualifying `assistant_message_end`
 * event exists. The frontend treats an absent value as "content not
 * available from this harness build yet" and renders an empty state.
 * The nested shape is `WireContextContents` (all fields optional) so
 * older builds decode defensively.
 */
export interface ContextContentsResponse {
  context_contents?: WireContextContents;
}

export const agentTemplatesApi = {
  // `orgId` scopes the listing to the full org fleet (every member's
  // agents, not just the caller's). Without it aura-network filters by
  // `WHERE user_id = $1`, which means teammates' agents never appear.
  // The server forwards the query to aura-network which verifies org
  // membership before dropping the user_id filter.
  list: (orgId?: string) => {
    const qs = orgId ? `?org_id=${encodeURIComponent(orgId)}` : "";
    return apiFetch<Agent[]>(`/api/agents${qs}`);
  },
  create: (data: {
    org_id?: string;
    name: string;
    role: string;
    personality: string;
    system_prompt: string;
    skills?: string[];
    icon?: string;
    machine_type?: string;
    adapter_type?: string;
    environment?: string;
    auth_source?: string;
    integration_id?: string | null;
    default_model?: string | null;
    tags?: string[];
    /** Marketplace listing status. Phase 2: sent alongside the legacy
     * `listing_status:` tag so the server can validate centrally. */
    listing_status?: string;
    /** Marketplace expertise slugs. The server folds them into `tags`. */
    expertise?: string[];
    /** Local-only per-agent working directory override (absolute OS path). */
    local_workspace_path?: string | null;
    /** Required capability + scope bundle. Backend rejects creates without. */
    permissions: AgentPermissions;
    /** Optional intent-classifier spec; CEO agents ship one. */
    intent_classifier?: IntentClassifierSpec | null;
  }) =>
    apiFetch<Agent>("/api/agents", { method: "POST", body: JSON.stringify(data) }),
  get: (agentId: AgentId, options?: ApiRequestOptions) =>
    apiFetch<Agent>(`/api/agents/${agentId}`, { signal: options?.signal }),
  update: (agentId: AgentId, data: {
    name?: string;
    role?: string;
    personality?: string;
    system_prompt?: string;
    skills?: string[];
    icon?: string | null;
    machine_type?: string;
    adapter_type?: string;
    environment?: string;
    auth_source?: string;
    integration_id?: string | null;
    default_model?: string | null;
    tags?: string[];
    listing_status?: string;
    expertise?: string[];
    /**
     * Patch semantics for the local workspace override:
     * - `undefined` (omitted): leave the stored value unchanged.
     * - `null` or `""`: clear the override.
     * - `string`: set the override to this absolute path.
     */
    local_workspace_path?: string | null;
    /** Replaces the permissions bundle wholesale. `undefined` leaves it. */
    permissions?: AgentPermissions;
    /** Replaces the intent-classifier spec. `undefined` leaves it. */
    intent_classifier?: IntentClassifierSpec | null;
  }) =>
    apiFetch<Agent>(`/api/agents/${agentId}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (agentId: AgentId) => apiFetch<void>(`/api/agents/${agentId}`, { method: "DELETE" }),
  listProjectBindings: (agentId: AgentId) =>
    apiFetch<{ project_agent_id: string; project_id: string; project_name: string }[]>(`/api/agents/${agentId}/projects`),
  removeProjectBinding: (agentId: AgentId, projectAgentId: string) =>
    apiFetch<void>(`/api/agents/${agentId}/projects/${projectAgentId}`, { method: "DELETE" }),
  listEvents: (agentId: AgentId, options?: AgentEventsRequestOptions) => {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    if (options?.offset != null) {
      params.set("offset", String(options.offset));
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return apiFetch<SessionEvent[]>(`/api/agents/${agentId}/events${query}`, {
      signal: options?.signal,
    });
  },
  /**
   * Per-session standalone-agent events read. Sister of
   * `sessionsApi.listSessionEvents` for the project-scoped surface;
   * `useStandaloneAgentChat` calls this whenever a `?session=` pin is
   * in the URL so the chat panel stays scoped to that single session
   * instead of falling back to the per-agent timeline (which
   * aggregates across every session of the agent and used to drag
   * old conversations back into view after the user pressed `+`).
   */
  listSessionEvents: (
    agentId: AgentId,
    sessionId: string,
    options?: AgentSessionEventsRequestOptions,
  ) => {
    const params = new URLSearchParams();
    if (options?.limit != null) {
      params.set("limit", String(options.limit));
    }
    if (options?.since) {
      params.set("since", options.since);
    }
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return apiFetch<SessionEvent[]>(
      `/api/agents/${agentId}/sessions/${sessionId}/events${query}`,
      { signal: options?.signal },
    );
  },
  /**
   * Cursor-paginated single-session history for a standalone agent.
   * Without `before`, returns the trailing `limit` messages plus
   * `has_more` / `next_cursor` for loading older pages.
   */
  listSessionEventsPaginated: (
    agentId: AgentId,
    sessionId: string,
    options?: PaginatedSessionEventsRequestOptions,
  ) =>
    apiFetch<PaginatedEventsResponse>(
      `/api/agents/${agentId}/sessions/${sessionId}/events/paginated${paginatedEventsQuery(options)}`,
      { signal: options?.signal },
    ),
  listEventsPaginated: (
    agentId: AgentId,
    options?: {
      before?: string;
      after?: string;
      limit?: number;
      signal?: AbortSignal;
    },
  ) => {
    const params = new URLSearchParams();
    if (options?.limit != null) params.set("limit", String(options.limit));
    if (options?.before) params.set("before", options.before);
    if (options?.after) params.set("after", options.after);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return apiFetch<PaginatedEventsResponse>(
      `/api/agents/${agentId}/events/paginated${query}`,
      { signal: options?.signal },
    );
  },
  sendEventStream: sendAgentEventStream,
  resetSession: (agentId: AgentId) =>
    apiFetch<void>(`/api/agents/${agentId}/reset-session`, { method: "POST" }),
  /**
   * Forward `HarnessInbound::Cancel` to every live chat session on the
   * bare-template partition and evict the warm sessions so the next
   * user message cold-starts cleanly. Used by `stopStreaming` to
   * unstick the per-partition turn slot when the user clicks Stop —
   * without this, a long-running turn (e.g. plan-mode `generate_specs`
   * full of non-terminal `progress` heartbeats) keeps the slot held
   * server-side, blocking the next send until the 90s SSE idle
   * timeout. Idempotent: the server returns 204 even when no live
   * session exists for the partition.
   */
  cancelTurn: (agentId: AgentId) =>
    apiFetch<void>(`/api/agents/${agentId}/cancel-turn`, { method: "POST" }),
  getContextUsage: (agentId: AgentId, options?: ApiRequestOptions) =>
    apiFetch<ContextUsageResponse>(
      `/api/agents/${agentId}/context-usage`,
      { signal: options?.signal },
    ),
  /**
   * Lazily fetch the rendered text the harness counted for each static
   * context bucket (system prompt / tools / skills / subagents / MCP),
   * scoped to the latest session across every project_agent that shares
   * this template agent id. Kept separate from {@link getContextUsage}
   * so the large text payload is only requested when a user opens a row
   * in the Context Composition popover.
   */
  getContextContents: (
    agentId: AgentId,
    options?: ApiRequestOptions,
  ): Promise<ContextContentsResponse> =>
    apiFetch<ContextContentsResponse>(
      `/api/agents/${agentId}/context-contents`,
      { signal: options?.signal },
    ),
  getInstalledTools: (
    agentId: AgentId,
    options?: ApiRequestOptions,
  ) =>
    apiFetch<AgentInstalledToolsDiagnostic>(
      `/api/agents/${agentId}/installed-tools`,
      { signal: options?.signal },
    ),
};

/**
 * Source of an installed tool row. Mirrors the backend
 * `InstalledToolDiagnosticRow.source` field.
 *
 * - `workspace`: app-provider / MCP / aura-native tools surfaced by the
 *   org's installed workspace integrations.
 * - `integration`: `InstalledIntegration` entries the harness sees
 *   alongside the tool list.
 */
export type InstalledToolDiagnosticSource =
  | "workspace"
  | "integration";

export interface InstalledToolDiagnosticRow {
  name: string;
  endpoint: string;
  source: InstalledToolDiagnosticSource;
  /**
   * Reserved for legacy diagnostic rows. Server-contributed rows omit it.
   */
  capability_origin?: string;
  /**
   * Whether the server can execute this row. Always `true` for current
   * `workspace` / `integration` rows.
   */
  registered: boolean;
}

export interface AgentInstalledToolsDiagnostic {
  agent_id: string;
  is_ceo_preset: boolean;
  agent_permissions: AgentPermissions;
  tools: InstalledToolDiagnosticRow[];
  /**
   * Legacy field retained for frontend compatibility. The server no
   * longer contributes cross-agent dispatcher rows, so this is empty.
   */
  missing_registrations: string[];
}

/**
 * Optional create-binding overrides accepted by both
 * {@link agentInstancesApi.createAgentInstance} and
 * {@link agentInstancesApi.createGeneralAgentInstance}.
 *
 * `source` stamps a provenance tag onto the new `project_agent` row.
 * Omitting it defaults to `"ui"` on the server, which keeps the row
 * visible in the projects sidebar (the legacy behavior). Non-UI
 * callers — new-project auto-attach, SDK scripts, benchmarks, e2e
 * fixtures — should set this explicitly so the sidebar's
 * `isUserFacingAgentInstance` filter hides them.
 */
export interface CreateAgentInstanceOptions {
  source?: AgentInstanceSource;
}

export const agentInstancesApi = {
  createAgentInstance: (
    projectId: ProjectId,
    agentId: AgentId,
    options?: CreateAgentInstanceOptions,
  ) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents`, {
      method: "POST",
      body: JSON.stringify({
        agent_id: agentId,
        ...(options?.source ? { source: options.source } : {}),
      }),
    }),
  createGeneralAgentInstance: (
    projectId: ProjectId,
    options?: CreateAgentInstanceOptions,
  ) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents`, {
      method: "POST",
      body: JSON.stringify({
        kind: "general",
        ...(options?.source ? { source: options.source } : {}),
      }),
    }),
  listAgentInstances: (projectId: ProjectId) =>
    apiFetch<AgentInstance[]>(`/api/projects/${projectId}/agents`),
  getAgentInstance: (projectId: ProjectId, agentInstanceId: AgentInstanceId, options?: ApiRequestOptions) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents/${agentInstanceId}`, { signal: options?.signal }),
  updateAgentInstance: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
    data: Partial<Pick<AgentInstance, "name" | "status">>,
  ) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents/${agentInstanceId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteAgentInstance: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<void>(`/api/projects/${projectId}/agents/${agentInstanceId}`, {
      method: "DELETE",
    }),
  getEvents: (projectId: ProjectId, agentInstanceId: AgentInstanceId, options?: ApiRequestOptions) =>
    apiFetch<SessionEvent[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/events`,
      { signal: options?.signal },
    ),
  sendEventStream,
  resetInstanceSession: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<void>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/reset-session`,
      { method: "POST" },
    ),
  /**
   * Project-instance counterpart to {@link agentTemplatesApi.cancelTurn}.
   * Forwards `HarnessInbound::Cancel` to every live chat session on
   * the `{template}::{instance_id}::*` partition and evicts the warm
   * sessions. Called fire-and-forget from `stopStreaming` so a Stop
   * press unsticks the partition immediately rather than relying on
   * the server-side SSE drop guard alone.
   */
  cancelInstanceTurn: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<void>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/cancel-turn`,
      { method: "POST" },
    ),
  getContextUsage: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
    options?: ApiRequestOptions,
  ) =>
    apiFetch<ContextUsageResponse>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/context-usage`,
      { signal: options?.signal },
    ),
  /**
   * Project-instance counterpart to
   * {@link agentTemplatesApi.getContextContents}. Returns the latest
   * persisted rendered context contents for a single agent instance,
   * fetched lazily when a user opens a bucket in the Context
   * Composition popover.
   */
  getContextContents: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
    options?: ApiRequestOptions,
  ): Promise<ContextContentsResponse> =>
    apiFetch<ContextContentsResponse>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/context-contents`,
      { signal: options?.signal },
    ),
};

export interface CleanupCeoResponse {
  kept?: string;
  deleted: string[];
  failed: string[];
}

export type PublicChatImportRole = "user" | "assistant";

export interface PublicChatImportTurn {
  role: PublicChatImportRole;
  content: string;
}

export interface PublicChatImportRequest {
  publicSessionId: string;
  title?: string;
  turns: PublicChatImportTurn[];
}

export interface PublicChatImportResponse {
  agentId: AgentId;
  agentInstanceId: AgentInstanceId;
  projectId: ProjectId;
  sessionId: string;
  importedTurnCount: number;
  reusedExisting: boolean;
}

export const superAgentApi = {
  setup: () => apiFetch<{ agent: Agent; created: boolean }>("/api/agents/harness/setup", { method: "POST" }),
  importPublicSession: (agentId: AgentId, body: PublicChatImportRequest) =>
    apiFetch<PublicChatImportResponse>(
      `/api/agents/${agentId}/public-chat/import`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  /**
   * Dedupe CEO bootstrap agents on the server: keep the oldest CEO,
   * delete the rest. Never creates a new agent.
   */
  cleanup: () =>
    apiFetch<CleanupCeoResponse>("/api/agents/harness/cleanup", {
      method: "POST",
    }),
  listOrchestrations: () => apiFetch<AgentOrchestration[]>("/api/agent-orchestrations"),
  getOrchestration: (id: string) => apiFetch<AgentOrchestration>(`/api/agent-orchestrations/${id}`),
};

/**
 * `Session` enriched with cross-binding agent metadata. Returned by
 * `/api/me/sessions` so the chat-app left panel can render rows for
 * every session the current user owns -- across every agent and
 * project -- in a single HTTP call. Mirrors `aura_os_core::EnrichedSession`.
 *
 * `agent_id` is the agent identifier the FE keys avatars and stream
 * lanes by (distinct from `Session.agent_instance_id`, which is the
 * per-project instance binding row id). May be absent when the
 * binding was deleted/migrated under the session, in which case the
 * row still surfaces (no avatar lookup) rather than vanishing.
 */
export interface EnrichedSession extends Session {
  agent_id?: AgentId;
}

export const sessionsApi = {
  listProjectSessions: (projectId: ProjectId) =>
    apiFetch<Session[]>(`/api/projects/${projectId}/sessions`),
  /**
   * User-scoped cross-agent session list. Powers the chat-app left
   * panel which used to fan out one `listSessions(project, agent)`
   * call per (agent, project_binding) pair on first paint. Now it's
   * a single indexed query into aura-storage (migration 0015's
   * `idx_sessions_user_recent` partial index).
   */
  listMySessions: () => apiFetch<EnrichedSession[]>(`/api/me/sessions`),
  /**
   * Read-only lexical recall over the caller's completed chats. Results are
   * source-linked excerpts, not active-chat context; callers must require an
   * explicit user action before opening a source or adding an excerpt to a
   * draft.
   */
  searchMySessionHistory: (query: string, limit?: number) => {
    const params = new URLSearchParams({ q: query });
    if (limit != null) params.set("limit", String(limit));
    return apiFetch<RecallSearchResponse>(
      `/api/me/sessions/search?${params.toString()}`,
      { timeoutMs: RECALL_SEARCH_TIMEOUT_MS },
    );
  },
  listSessions: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<Session[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions`,
    ),
  getSession: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<Session>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}`,
    ),
  getSafeWorkspaceStatus: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
    sessionId: string,
  ) =>
    apiFetch<SafeWorkspaceStatus>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/safe-workspace`,
    ),
  getSafeWorkspaceEligibility: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
  ) =>
    apiFetch<SafeWorkspaceEligibility>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/safe-workspace-eligibility`,
    ),
  getSafeWorkspaceDiff: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
    sessionId: string,
    checkpointId: string,
  ) =>
    apiFetch<SafeWorkspaceDiff>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/safe-workspace/checkpoints/${checkpointId}/diff`,
    ),
  restoreSafeWorkspaceCheckpoint: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
    sessionId: string,
    checkpointId: string,
  ) =>
    apiFetch<SafeWorkspaceRestoreResult>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/safe-workspace/checkpoints/${checkpointId}/restore`,
      { method: "POST" },
    ),
  applySafeWorkspaceToProject: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
    sessionId: string,
  ) =>
    apiFetch<SafeWorkspaceApplyResult>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/safe-workspace/apply`,
      { method: "POST" },
    ),
  listSessionTasks: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<Task[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/tasks`,
    ),
  listSessionEvents: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<SessionEvent[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/events`,
    ),
  /**
   * Cursor-paginated session history. Without `before`, returns the
   * trailing `limit` messages plus `has_more` / `next_cursor` for
   * loading older pages on upward scroll.
   */
  listSessionEventsPaginated: (
    projectId: ProjectId,
    agentInstanceId: AgentInstanceId,
    sessionId: string,
    options?: PaginatedSessionEventsRequestOptions,
  ) =>
    apiFetch<PaginatedEventsResponse>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/events/paginated${paginatedEventsQuery(options)}`,
      { signal: options?.signal },
    ),
  summarizeSession: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<Session>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/summarize`,
      { method: "POST" },
    ),
  deleteSession: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<void>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}`,
      { method: "DELETE" },
    ),
};
