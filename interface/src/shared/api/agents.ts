import type {
  ProjectId,
  AgentId,
  AgentInstanceId,
  Agent,
  AgentInstance,
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

type ApiRequestOptions = {
  signal?: AbortSignal;
};

export const STANDALONE_AGENT_HISTORY_LIMIT = 80;

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

export const agentInstancesApi = {
  createAgentInstance: (projectId: ProjectId, agentId: AgentId) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    }),
  createGeneralAgentInstance: (projectId: ProjectId) =>
    apiFetch<AgentInstance>(`/api/projects/${projectId}/agents`, {
      method: "POST",
      body: JSON.stringify({ kind: "general" }),
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
};

export interface CleanupCeoResponse {
  kept?: string;
  deleted: string[];
  failed: string[];
}

export const superAgentApi = {
  setup: () => apiFetch<{ agent: Agent; created: boolean }>("/api/agents/harness/setup", { method: "POST" }),
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

export const sessionsApi = {
  listProjectSessions: (projectId: ProjectId) =>
    apiFetch<Session[]>(`/api/projects/${projectId}/sessions`),
  listSessions: (projectId: ProjectId, agentInstanceId: AgentInstanceId) =>
    apiFetch<Session[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions`,
    ),
  getSession: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<Session>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}`,
    ),
  listSessionTasks: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<Task[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/tasks`,
    ),
  listSessionEvents: (projectId: ProjectId, agentInstanceId: AgentInstanceId, sessionId: string) =>
    apiFetch<SessionEvent[]>(
      `/api/projects/${projectId}/agents/${agentInstanceId}/sessions/${sessionId}/events`,
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
