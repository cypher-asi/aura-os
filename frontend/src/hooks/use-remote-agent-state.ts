import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { RemoteVmState } from "../types";
import { useEventStore } from "../stores/event-store";
import { useProfileStatusStore } from "../stores/profile-status-store";
import { EventType } from "../types/aura-events";

const POLL_INTERVAL_MS = 30_000;

function syncToProfileStore(agentId: string, state: string) {
  const store = useProfileStatusStore.getState();
  if (store.statuses[agentId] !== state) {
    useProfileStatusStore.setState((s) => ({
      statuses: { ...s.statuses, [agentId]: state },
    }));
  }
}

export function useRemoteAgentState(agentId: string | undefined) {
  const [data, setData] = useState<RemoteVmState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subscribe = useEventStore((s) => s.subscribe);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;

    const fetchState = () => {
      api.swarm
        .getRemoteAgentState(agentId)
        .then((state) => {
          if (!cancelled) {
            setData(state);
            setError(null);
            syncToProfileStore(agentId, state.state);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    fetchState();
    const interval = setInterval(fetchState, POLL_INTERVAL_MS);

    const unsubscribe = subscribe(EventType.RemoteAgentStateChanged, (event) => {
      if (event.content?.agent_id === agentId) {
        setData({
          state: event.content.state,
          uptime_seconds: event.content.uptime_seconds,
          active_sessions: event.content.active_sessions,
          error_message: event.content.error_message,
        });
        syncToProfileStore(agentId, event.content.state);
      }
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [agentId, subscribe]);

  return { data, loading, error };
}
