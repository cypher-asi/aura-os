import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { RemoteVmState } from "../shared/types";
import { useEventStore } from "../stores/event-store/index";
import { EventType } from "../shared/types/aura-events";

const POLL_INTERVAL_MS = 30_000;
/**
 * Slow cadence once the VM has settled into a terminal state (`error` /
 * `stopped`) or keeps failing — stops a dead/stuck machine from flooding
 * `/remote_agent/state` every 30s. A later successful poll resets the
 * cadence, and the WS push below keeps status live in the meantime.
 */
const SETTLED_POLL_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

function isTerminalVmState(state: string | undefined): boolean {
  return state === "error" || state === "stopped";
}

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;

    // Recursive timeout (vs setInterval) so each tick can back off when the
    // VM is terminal or unreachable — see SETTLED_POLL_INTERVAL_MS.
    const tick = () => {
      let terminal = false;
      api.swarm
        .getRemoteAgentState(agentId)
        .then((state) => {
          if (cancelled) return;
          consecutiveFailures = 0;
          terminal = isTerminalVmState(state.state);
          setData(state);
          setError(null);
        })
        .catch((e) => {
          if (cancelled) return;
          consecutiveFailures += 1;
          setError(e.message);
        })
        .finally(() => {
          if (cancelled) return;
          setLoading(false);
          const settled =
            terminal || consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES;
          timer = setTimeout(
            tick,
            settled ? SETTLED_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
          );
        });
    };

    tick();

    const unsubscribe = subscribe(EventType.RemoteAgentStateChanged, (event) => {
      const c = event.content;
      if (c?.agent_id !== agentId) return;
      // The WS event only carries lifecycle fields; preserve the
      // poll-only fields (endpoint, runtime_version, etc.) so the IP and
      // other VM details don't blank out between polls.
      setData((prev) => ({
        state: c.state,
        uptime_seconds: c.uptime_seconds ?? prev?.uptime_seconds ?? 0,
        active_sessions: c.active_sessions ?? prev?.active_sessions ?? 0,
        error_message: c.error_message,
        endpoint: prev?.endpoint,
        runtime_version: prev?.runtime_version,
        harness_git_sha: prev?.harness_git_sha,
        isolation: prev?.isolation,
        cpu_millicores: prev?.cpu_millicores,
        memory_mb: prev?.memory_mb,
        agent_id: prev?.agent_id ?? agentId,
      }));
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [agentId, subscribe]);

  return { data, loading, error };
}
