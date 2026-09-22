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

export interface AgentActiveRunItem {
  agentId: string;
  projectId?: string;
  agentInstanceId?: string;
  sessionId?: string;
  route?: string;
  startedAt: number;
}

interface AgentAttentionState {
  pendingApprovals: Record<string, AgentAttentionItem | undefined>;
  activeRuns: Record<string, AgentActiveRunItem | undefined>;
  hydrated: boolean;
  replace: (
    approvals: AgentAttentionItem[],
    activeRuns: AgentActiveRunItem[],
  ) => void;
  upsert: (item: AgentAttentionItem) => void;
  resolve: (requestId: string) => void;
  startRun: (key: string, item: AgentActiveRunItem) => void;
  finishRun: (key: string) => void;
  clear: () => void;
}

let hydratePromise: Promise<void> | null = null;
let liveMutationVersion = 0;
let resetEpoch = 0;
const resolvedRequestIds = new Set<string>();
const finishedRunVersions = new Map<string, number>();

export const useAgentAttentionStore = create<AgentAttentionState>()((set) => ({
  pendingApprovals: {},
  activeRuns: {},
  hydrated: false,
  replace: (items, runs) => {
    const pendingApprovals: Record<string, AgentAttentionItem> = {};
    for (const item of items) pendingApprovals[item.requestId] = item;
    const activeRuns: Record<string, AgentActiveRunItem> = {};
    for (const item of runs) activeRuns[runKey(item)] = item;
    set({ pendingApprovals, activeRuns, hydrated: true });
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
  startRun: (key, item) => {
    liveMutationVersion += 1;
    finishedRunVersions.delete(key);
    set((state) => ({ activeRuns: { ...state.activeRuns, [key]: item } }));
  },
  finishRun: (key) => {
    liveMutationVersion += 1;
    finishedRunVersions.set(key, liveMutationVersion);
    set((state) => {
      if (!(key in state.activeRuns)) return state;
      const activeRuns = { ...state.activeRuns };
      delete activeRuns[key];
      return { activeRuns };
    });
  },
  clear: () => {
    liveMutationVersion += 1;
    resetEpoch += 1;
    hydratePromise = null;
    resolvedRequestIds.clear();
    finishedRunVersions.clear();
    set({ pendingApprovals: {}, activeRuns: {}, hydrated: false });
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

function runKey(
  item: Pick<
    AgentActiveRunItem,
    "agentId" | "projectId" | "agentInstanceId" | "sessionId"
  >,
): string {
  return [item.agentId, item.projectId ?? "", item.agentInstanceId ?? "", item.sessionId ?? ""]
    .map(encodeURIComponent)
    .join(":");
}

function activeRunFromEvent(event: AuraEvent): AgentActiveRunItem | null {
  const content = event.content as { agent_id?: string };
  const agentId = clean(event.agent_id || content.agent_id);
  if (!agentId) return null;
  const projectId = clean(event.project_id);
  const agentInstanceId = clean(event.project_agent_id);
  const sessionId = clean(event.session_id);
  return {
    agentId,
    projectId,
    agentInstanceId,
    sessionId,
    route: buildAgentSessionRoute({
      projectId,
      agentInstanceId,
      agentId,
      sessionId,
    }),
    startedAt: Date.parse(event.created_at) || Date.now(),
  };
}

/** Refresh pending attention from the authenticated server snapshot. */
export function hydrateAgentAttention(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  const startedAtVersion = liveMutationVersion;
  const startedAtResetEpoch = resetEpoch;
  const hydration = Promise.all([
    streamsApi.listPendingToolApprovals(),
    streamsApi.listActiveStreams(),
  ])
    .then(([{ approvals }, { streams }]) => {
      if (startedAtResetEpoch !== resetEpoch) return;
      const fetched = approvals
        .map(fromSummary)
        .filter((item): item is AgentAttentionItem => item !== null)
        .filter((item) => !resolvedRequestIds.has(item.requestId));
      const fetchedRuns = streams.flatMap((stream) => {
        if (stream.kind !== "chat_turn") return [];
        const agentId = clean(stream.scope.agent_id);
        if (!agentId) return [];
        const projectId = clean(stream.scope.project_id);
        const agentInstanceId = clean(stream.scope.agent_instance_id);
        const sessionId = clean(stream.scope.session_id);
        const item: AgentActiveRunItem = {
          agentId,
          projectId,
          agentInstanceId,
          sessionId,
          route: buildAgentSessionRoute({
            projectId,
            agentInstanceId,
            agentId,
            sessionId,
          }),
          startedAt: stream.started_at_ms,
        };
        const finishVersion = finishedRunVersions.get(runKey(item)) ?? 0;
        return finishVersion > startedAtVersion ? [] : [item];
      });
      if (startedAtVersion === liveMutationVersion) {
        useAgentAttentionStore.getState().replace(fetched, fetchedRuns);
        return;
      }
      const current = useAgentAttentionStore.getState().pendingApprovals;
      const merged = new Map<string, AgentAttentionItem>();
      for (const item of fetched) merged.set(item.requestId, item);
      for (const item of Object.values(current)) {
        if (item && !resolvedRequestIds.has(item.requestId)) merged.set(item.requestId, item);
      }
      const currentRuns = useAgentAttentionStore.getState().activeRuns;
      const mergedRuns = new Map<string, AgentActiveRunItem>();
      for (const item of fetchedRuns) mergedRuns.set(runKey(item), item);
      for (const item of Object.values(currentRuns)) {
        const finishVersion = item ? finishedRunVersions.get(runKey(item)) ?? 0 : 0;
        if (item && finishVersion <= startedAtVersion) mergedRuns.set(runKey(item), item);
      }
      useAgentAttentionStore
        .getState()
        .replace([...merged.values()], [...mergedRuns.values()]);
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
  if (event.type === EventType.UserMessage) {
    const item = activeRunFromEvent(event);
    if (item) useAgentAttentionStore.getState().startRun(runKey(item), item);
    return;
  }
  if (event.type === EventType.AssistantMessageEnd) {
    const item = activeRunFromEvent(event);
    if (item) useAgentAttentionStore.getState().finishRun(runKey(item));
    return;
  }
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
