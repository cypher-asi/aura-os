import { useCallback, useEffect, useMemo } from "react";
import {
  api,
  STANDALONE_AGENT_HISTORY_LIMIT,
} from "../../../api/client";
import { useChatHistoryStore, agentHistoryKey, sessionHistoryKey } from "../../../stores/chat-history-store";
import {
  agentSessionsSurfaceKey,
  findMostRecentRealSession,
  useSessionsListStore,
} from "../../../stores/sessions-list-store";
import type { Agent } from "../../../shared/types";

export function useAgentPrefetch({
  agents,
  agentId,
  isMobileLibrary,
  isDesktopSidebar,
}: {
  agents: Agent[];
  agentId: string | undefined;
  isMobileLibrary: boolean;
  isDesktopSidebar: boolean;
}) {
  const warmDestinationSessionForAgent = useCallback((selectedAgentId: string) => {
    const sessionsStore = useSessionsListStore.getState();
    const surfaceKey = agentSessionsSurfaceKey(selectedAgentId);
    const tryWarmFromCurrentSnapshot = () => {
      const list = useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      if (!list || list.length === 0) return;
      const mostRecent = findMostRecentRealSession(list);
      if (!mostRecent) return;
      const key = sessionHistoryKey(
        mostRecent._projectId,
        mostRecent._agentInstanceId,
        mostRecent.session_id,
      );
      void useChatHistoryStore.getState().fetchHistory(
        key,
        () =>
          api.listSessionEvents(
            mostRecent._projectId,
            mostRecent._agentInstanceId,
            mostRecent.session_id,
          ),
      );
    };
    if (sessionsStore.sessionsBySurface[surfaceKey] !== undefined) {
      tryWarmFromCurrentSnapshot();
      return;
    }
    void sessionsStore.loadAgentSessions(selectedAgentId).then(() => {
      tryWarmFromCurrentSnapshot();
    });
  }, []);

  const handleHoverPrefetch = useCallback((selectedAgentId: string) => {
    if (isMobileLibrary) return;
    useChatHistoryStore.getState().prefetchHistory(
      agentHistoryKey(selectedAgentId),
      () =>
        api.agents.listEvents(selectedAgentId, {
          limit: STANDALONE_AGENT_HISTORY_LIMIT,
        }),
    );
    warmDestinationSessionForAgent(selectedAgentId);
  }, [isMobileLibrary, warmDestinationSessionForAgent]);

  const prefetchAgentIds = useMemo(() => {
    if (!isDesktopSidebar) return [];
    return agents.map((a) => a.agent_id).filter((id) => id !== agentId);
  }, [agents, isDesktopSidebar, agentId]);

  const activeHistoryResolved = useChatHistoryStore((s) => {
    if (!isDesktopSidebar || !agentId) return true;
    const entry = s.entries[agentHistoryKey(agentId)];
    return entry?.status === "ready" || entry?.status === "error";
  });

  useEffect(() => {
    if (prefetchAgentIds.length === 0) return;
    if (!activeHistoryResolved) return;
    const CONCURRENCY = 2;
    let cancelled = false;
    const queue = [...prefetchAgentIds];
    const runWhenIdle = (cb: () => void) => {
      const ric = (
        window as unknown as {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }
      ).requestIdleCallback;
      if (typeof ric === "function") {
        ric(cb, { timeout: 500 });
      } else {
        setTimeout(cb, 0);
      }
    };
    const worker = async () => {
      while (!cancelled && queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        try {
          await useChatHistoryStore.getState().fetchHistory(
            agentHistoryKey(id),
            () =>
              api.agents.listEvents(id, {
                limit: STANDALONE_AGENT_HISTORY_LIMIT,
              }),
          );
        } catch {
          // errors are stored on the history entry; keep draining the queue
        }
        if (cancelled) break;
        warmDestinationSessionForAgent(id);
      }
    };
    runWhenIdle(() => {
      if (cancelled) return;
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, prefetchAgentIds.length) },
        () => worker(),
      );
      void Promise.all(workers);
    });
    return () => {
      cancelled = true;
    };
  }, [prefetchAgentIds, activeHistoryResolved, warmDestinationSessionForAgent]);

  return { handleHoverPrefetch };
}
