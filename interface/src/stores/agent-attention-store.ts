import { create } from "zustand";

import {
  streamsApi,
  type PendingToolApprovalSummary,
  type PendingUserInputSummary,
  type UserInputQuestion,
} from "../shared/api/streams";
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

export interface AgentUserInputItem {
  kind: "input";
  requestId: string;
  questions: UserInputQuestion[];
  agentId: string;
  projectId?: string;
  agentInstanceId?: string;
  sessionId?: string;
  route?: string;
  startedAt: number;
}

interface AgentAttentionState {
  pendingApprovals: Record<string, AgentAttentionItem | undefined>;
  pendingInputs: Record<string, AgentUserInputItem | undefined>;
  activeRuns: Record<string, AgentActiveRunItem | undefined>;
  hydrated: boolean;
  replace: (
    approvals: AgentAttentionItem[],
    inputs: AgentUserInputItem[],
    activeRuns: AgentActiveRunItem[],
  ) => void;
  upsert: (item: AgentAttentionItem) => void;
  resolve: (requestId: string) => void;
  upsertInput: (item: AgentUserInputItem) => void;
  resolveInput: (requestId: string) => void;
  startRun: (key: string, item: AgentActiveRunItem) => void;
  finishRun: (key: string) => void;
  clear: () => void;
}

let hydratePromise: Promise<void> | null = null;
let liveMutationVersion = 0;
let resetEpoch = 0;
const resolvedRequestIds = new Set<string>();
const resolvedInputRequestIds = new Set<string>();
const finishedRunVersions = new Map<string, number>();

export const useAgentAttentionStore = create<AgentAttentionState>()((set) => ({
  pendingApprovals: {},
  pendingInputs: {},
  activeRuns: {},
  hydrated: false,
  replace: (items, inputs, runs) => {
    const pendingApprovals: Record<string, AgentAttentionItem> = {};
    for (const item of items) pendingApprovals[item.requestId] = item;
    const pendingInputs: Record<string, AgentUserInputItem> = {};
    for (const item of inputs) pendingInputs[item.requestId] = item;
    const activeRuns: Record<string, AgentActiveRunItem> = {};
    for (const item of runs) activeRuns[runKey(item)] = item;
    set({ pendingApprovals, pendingInputs, activeRuns, hydrated: true });
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
  upsertInput: (item) => {
    liveMutationVersion += 1;
    resolvedInputRequestIds.delete(item.requestId);
    set((state) => ({
      pendingInputs: { ...state.pendingInputs, [item.requestId]: item },
    }));
  },
  resolveInput: (requestId) => {
    liveMutationVersion += 1;
    resolvedInputRequestIds.add(requestId);
    set((state) => {
      if (!(requestId in state.pendingInputs)) return state;
      const pendingInputs = { ...state.pendingInputs };
      delete pendingInputs[requestId];
      return { pendingInputs };
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
    resolvedInputRequestIds.clear();
    finishedRunVersions.clear();
    set({ pendingApprovals: {}, pendingInputs: {}, activeRuns: {}, hydrated: false });
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

function inputFromSummary(summary: PendingUserInputSummary): AgentUserInputItem | null {
  const requestId = clean(summary.request_id);
  const agentId = clean(summary.agent_id);
  if (!requestId || !agentId || summary.questions.length === 0) return null;
  const projectId = clean(summary.project_id);
  const agentInstanceId = clean(summary.agent_instance_id);
  const sessionId = clean(summary.session_id);
  return {
    kind: "input",
    requestId,
    questions: summary.questions,
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

/**
 * Remove a run after the environment accepted an explicit cross-client Stop.
 * Recording the finish version also prevents a slower attention hydration
 * that began before the Stop from resurrecting the stale activity row.
 */
export function markAgentRunStopped(item: AgentActiveRunItem): void {
  useAgentAttentionStore.getState().finishRun(runKey(item));
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
    streamsApi.listPendingToolApprovals().catch(() => ({ approvals: [] })),
    streamsApi.listPendingUserInputs().catch(() => ({ requests: [] })),
    streamsApi.listActiveStreams().catch(() => ({ streams: [] })),
  ])
    .then(([{ approvals }, { requests }, { streams }]) => {
      if (startedAtResetEpoch !== resetEpoch) return;
      const fetched = approvals
        .map(fromSummary)
        .filter((item): item is AgentAttentionItem => item !== null)
        .filter((item) => !resolvedRequestIds.has(item.requestId));
      const fetchedInputs = requests
        .map(inputFromSummary)
        .filter((item): item is AgentUserInputItem => item !== null)
        .filter((item) => !resolvedInputRequestIds.has(item.requestId));
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
        useAgentAttentionStore.getState().replace(fetched, fetchedInputs, fetchedRuns);
        return;
      }
      const current = useAgentAttentionStore.getState().pendingApprovals;
      const merged = new Map<string, AgentAttentionItem>();
      for (const item of fetched) merged.set(item.requestId, item);
      for (const item of Object.values(current)) {
        if (item && !resolvedRequestIds.has(item.requestId)) merged.set(item.requestId, item);
      }
      const currentRuns = useAgentAttentionStore.getState().activeRuns;
      const currentInputs = useAgentAttentionStore.getState().pendingInputs;
      const mergedInputs = new Map<string, AgentUserInputItem>();
      for (const item of fetchedInputs) mergedInputs.set(item.requestId, item);
      for (const item of Object.values(currentInputs)) {
        if (item && !resolvedInputRequestIds.has(item.requestId)) {
          mergedInputs.set(item.requestId, item);
        }
      }
      const mergedRuns = new Map<string, AgentActiveRunItem>();
      for (const item of fetchedRuns) mergedRuns.set(runKey(item), item);
      for (const item of Object.values(currentRuns)) {
        const finishVersion = item ? finishedRunVersions.get(runKey(item)) ?? 0 : 0;
        if (item && finishVersion <= startedAtVersion) mergedRuns.set(runKey(item), item);
      }
      useAgentAttentionStore
        .getState()
        .replace([...merged.values()], [...mergedInputs.values()], [...mergedRuns.values()]);
    });
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
  if (event.type === EventType.AgentUserInputResolved) {
    useAgentAttentionStore.getState().resolveInput(event.content.request_id);
    return;
  }
  if (event.type === EventType.AgentUserInputRequested) {
    const requestId = clean(event.content.request_id);
    const agentId = clean(event.agent_id || event.content.agent_id);
    if (!requestId || !agentId || event.content.questions.length === 0) return;
    const projectId = clean(event.project_id || event.content.project_id);
    const agentInstanceId = clean(
      event.project_agent_id || event.content.agent_instance_id,
    );
    const sessionId = clean(event.session_id || event.content.session_id);
    useAgentAttentionStore.getState().upsertInput({
      kind: "input",
      requestId,
      questions: event.content.questions,
      agentId,
      projectId,
      agentInstanceId,
      sessionId,
      route: buildAgentSessionRoute({ projectId, agentInstanceId, agentId, sessionId }),
      startedAt: Date.parse(event.created_at) || Date.now(),
    });
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
