import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { RemoteVmState } from "../types";
import { useEventStore } from "../stores/event-store";
import { EventType } from "../types/aura-events";

const POLL_INTERVAL_MS = 30_000;

/**
 * Fetches and polls detailed remote VM state for a single agent.
 * Used by AgentEnvironment popover for rich VM info (uptime, sessions, etc.).
 *
 * Status syncing to profile-status-store is handled centrally by the store
 * itself via registerRemoteAgents polling and WS events -- this hook no
 * longer writes to the store directly.
 */
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
