import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { resolveAvatarState } from "../../../hooks/use-avatar-state";
import {
  aggregateRows,
  useLoopActivityStore,
  type LoopRow,
} from "../../../stores/loop-activity-store";
import { useProfileStatusStore } from "../../../stores/profile-status-store";
import { useChatHistoryStore, agentHistoryKey } from "../../../stores/chat-history-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { useStreamStore } from "../../../hooks/stream/store";
import { useAgentStore } from "../stores";
import { isLoopActivityActive, type LoopActivityPayload } from "../../../shared/types/aura-events";
import type { Agent } from "../../../shared/types";
import type { DisplaySessionEvent } from "../../../shared/types/stream";

/**
 * Everything an `AgentConversationRow` needs to render, resolved once per row
 * instead of via per-row store subscriptions. See {@link useAgentRowModels}.
 */
export interface AgentRowModel {
  status?: string;
  isLocal: boolean;
  busy: boolean;
  loopActivity: LoopActivityPayload | null;
  lastMessage?: DisplaySessionEvent;
  isPinned: boolean;
}

interface UseAgentRowModelsOptions {
  /** When false (mobile library), previews are skipped entirely. */
  includePreview: boolean;
}

/**
 * Batched, list-level replacement for the per-row `useAvatarState` /
 * `useIsAgentBusy` / `LoopProgress` / pinned / preview subscriptions.
 *
 * The agent sidebar re-mounts its visible row window on every Agents <->
 * Projects switch (the virtualizer drops rows while the pane is
 * `display: none`). When each row owned ~9 store subscriptions plus an image,
 * that re-mount was the switch's bottleneck. Reading every store once here and
 * handing each row a plain `AgentRowModel` makes the rows pure and cheap to
 * mount — the same shape that keeps the Projects list instant.
 *
 * This hook re-renders `AgentList` on the relevant store ticks (like
 * `ProjectsNav` does), but each render only rebuilds two O(n) maps and the
 * memoized rows bail unless their own values changed.
 */
export function useAgentRowModels(
  agents: Agent[],
  { includePreview }: UseAgentRowModelsOptions,
): Map<string, AgentRowModel> {
  const statuses = useProfileStatusStore((s) => s.statuses);
  const machineTypes = useProfileStatusStore((s) => s.machineTypes);
  const previewLastMessages = useChatHistoryStore((s) => s.previewLastMessages);
  const pinnedAgentIds = useAgentStore((s) => s.pinnedAgentIds);
  const loops = useLoopActivityStore((s) => s.loops);
  // Narrowed subscription: only the per-agent `isStreaming` flags this
  // list actually consumes. Subscribing to the whole `entries` object
  // re-ran the row-model build on EVERY streaming tick of every
  // conversation (once per animation frame during a live turn); with
  // `useShallow` over the boolean map, the list only re-renders when a
  // flag actually flips.
  const standaloneStreamingById = useStreamStore(
    useShallow((s) => {
      const flags: Record<string, boolean> = {};
      for (const agent of agents) {
        if (s.entries[agent.agent_id]?.isStreaming) flags[agent.agent_id] = true;
      }
      return flags;
    }),
  );
  const streamingAgentInstanceIds = useSidekickStore((s) => s.streamingAgentInstanceIds);
  const instanceIdsByTemplateId = useProjectsListStore((s) => s.instanceIdsByTemplateId);

  // One pass over the (small) live-loop map groups rows by template agent id so
  // per-agent aggregation below is an O(1) lookup instead of an O(loops) scan.
  const loopsByAgentId = useMemo(() => {
    const index = new Map<string, LoopRow[]>();
    for (const row of Object.values(loops)) {
      const agentId = row.loopId.agent_id;
      if (!agentId) continue;
      const bucket = index.get(agentId);
      if (bucket) bucket.push(row);
      else index.set(agentId, [row]);
    }
    return index;
  }, [loops]);

  const streamingInstanceIdSet = useMemo(
    () => new Set(streamingAgentInstanceIds),
    [streamingAgentInstanceIds],
  );

  return useMemo(() => {
    const models = new Map<string, AgentRowModel>();
    for (const agent of agents) {
      const id = agent.agent_id;
      const { status, isLocal } = resolveAvatarState(statuses[id], machineTypes[id]);
      const loopActivity = aggregateRows(loopsByAgentId.get(id) ?? []);
      const hasActiveLoop = !!loopActivity && isLoopActivityActive(loopActivity.status);
      const standaloneStreaming = standaloneStreamingById[id] ?? false;
      const instanceIds = instanceIdsByTemplateId[id];
      const projectStreaming =
        !!instanceIds && instanceIds.some((instanceId) => streamingInstanceIdSet.has(instanceId));

      models.set(id, {
        status,
        isLocal,
        busy: hasActiveLoop || standaloneStreaming || projectStreaming,
        loopActivity,
        lastMessage: includePreview ? previewLastMessages[agentHistoryKey(id)] : undefined,
        isPinned: agent.is_pinned || pinnedAgentIds.has(id),
      });
    }
    return models;
  }, [
    agents,
    statuses,
    machineTypes,
    previewLastMessages,
    pinnedAgentIds,
    loopsByAgentId,
    standaloneStreamingById,
    streamingInstanceIdSet,
    instanceIdsByTemplateId,
    includePreview,
  ]);
}
