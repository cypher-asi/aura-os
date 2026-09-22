import { create } from "zustand";

import { streamsApi, type PendingToolApprovalSummary } from "../shared/api/streams";
import { buildAgentSessionRoute } from "../shared/lib/agent-session-route";
import { EventType, type AuraEvent } from "../shared/types/aura-events";

export interface AgentAttentionItem {
  kind: "approval";
  requestId: string;
  toolName: string;
  agentId: string;
  projectId?: string;
  agentInstanceId?: string;
  sessionId?: string;
  route?: string;
  startedAt: number;
}

interface AgentAttentionState {
  pendingApprovals: Record<string, AgentAttentionItem | undefined>;
  hydrated: boolean;
  replace: (items: AgentAttentionItem[]) => void;
  upsert: (item: AgentAttentionItem) => void;
  resolve: (requestId: string) => void;
  clear: () => void;
}

let hydratePromise: Promise<void> | null = null;
let liveMutationVersion = 0;
let resetEpoch = 0;
const resolvedRequestIds = new Set<string>();

export const useAgentAttentionStore = create<AgentAttentionState>()((set) => ({
  pendingApprovals: {},
  hydrated: false,
  replace: (items) => {
    const pendingApprovals: Record<string, AgentAttentionItem> = {};
    for (const item of items) pendingApprovals[item.requestId] = item;
    set({ pendingApprovals, hydrated: true });
  },
  upsert: (item) => {
    liveMutationVersion += 1;
    resolvedRequestIds.delete(item.requestId);
    set((state) => ({
      pendingApprovals: { ...state.pendingApprovals, [item.requestId]: item },
    }));
  },
  resolve: (requestId) => {
    liveMutationVersion += 1;
    resolvedRequestIds.add(requestId);
    set((state) => {
      if (!(requestId in state.pendingApprovals)) return state;
      const pendingApprovals = { ...state.pendingApprovals };
      delete pendingApprovals[requestId];
      return { pendingApprovals };
    });
  },
  clear: () => {
    liveMutationVersion += 1;
    resetEpoch += 1;
    hydratePromise = null;
    resolvedRequestIds.clear();
    set({ pendingApprovals: {}, hydrated: false });
  },
}));

function clean(value: string | null | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function fromSummary(summary: PendingToolApprovalSummary): AgentAttentionItem | null {
  const requestId = clean(summary.request_id);
  const toolName = clean(summary.tool_name);
  const agentId = clean(summary.agent_id);
  if (!requestId || !toolName || !agentId) return null;
  const projectId = clean(summary.project_id);
  const agentInstanceId = clean(summary.agent_instance_id);
  const sessionId = clean(summary.session_id);
  return {
    kind: "approval",
    requestId,
    toolName,
    agentId,
    projectId,
    agentInstanceId,
    sessionId,
    route: buildAgentSessionRoute({ projectId, agentInstanceId, agentId, sessionId }),
    startedAt: summary.started_at_ms,
  };
}

/** Refresh pending attention from the authenticated server snapshot. */
export function hydrateAgentAttention(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  const startedAtVersion = liveMutationVersion;
  const startedAtResetEpoch = resetEpoch;
  const hydration = streamsApi
    .listPendingToolApprovals()
    .then(({ approvals }) => {
      if (startedAtResetEpoch !== resetEpoch) return;
      const fetched = approvals
        .map(fromSummary)
        .filter((item): item is AgentAttentionItem => item !== null)
        .filter((item) => !resolvedRequestIds.has(item.requestId));
      if (startedAtVersion === liveMutationVersion) {
        useAgentAttentionStore.getState().replace(fetched);
        return;
      }
      const current = useAgentAttentionStore.getState().pendingApprovals;
      const merged = new Map<string, AgentAttentionItem>();
      for (const item of fetched) merged.set(item.requestId, item);
      for (const item of Object.values(current)) {
        if (item && !resolvedRequestIds.has(item.requestId)) merged.set(item.requestId, item);
      }
      useAgentAttentionStore.getState().replace([...merged.values()]);
    })
    .catch(() => {});
  const trackedHydration = hydration.finally(() => {
    if (hydratePromise === trackedHydration) hydratePromise = null;
  });
  hydratePromise = trackedHydration;
  return trackedHydration;
}

/** Apply live firehose deltas even when no agent list or chat is mounted. */
export function applyAgentAttentionEvent(event: AuraEvent): void {
  if (event.type === EventType.ToolApprovalResolved) {
    useAgentAttentionStore.getState().resolve(event.content.request_id);
    return;
  }
  if (event.type !== EventType.ToolApprovalPrompt) return;
  const requestId = clean(event.content.request_id);
  const toolName = clean(event.content.tool_name);
  const agentId = clean(event.agent_id || event.content.agent_id);
  if (!requestId || !toolName || !agentId) return;
  const projectId = clean(event.project_id);
  const agentInstanceId = clean(event.project_agent_id);
  const sessionId = clean(event.session_id);
  useAgentAttentionStore.getState().upsert({
    kind: "approval",
    requestId,
    toolName,
    agentId,
    projectId,
    agentInstanceId,
    sessionId,
    route: buildAgentSessionRoute({ projectId, agentInstanceId, agentId, sessionId }),
    startedAt: Date.parse(event.created_at) || Date.now(),
  });
}

export function clearAgentAttention(): void {
  useAgentAttentionStore.getState().clear();
}
