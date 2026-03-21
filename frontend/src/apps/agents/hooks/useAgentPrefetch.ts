import { useCallback } from "react";
import { useAgentStore, LAST_AGENT_ID_KEY } from "../stores";

export function useAgentPrefetch(): () => void {
  return useCallback(() => {
    const store = useAgentStore.getState();
    store.fetchAgents().catch(() => {});
    const lastId = localStorage.getItem(LAST_AGENT_ID_KEY);
    if (lastId) {
      store.prefetchHistory(lastId);
    }
  }, []);
}
