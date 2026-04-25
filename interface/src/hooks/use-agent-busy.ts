import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client";
import { useEventStore } from "../stores/event-store/index";
import { EventType } from "../shared/types/aura-events";
import { useIsStreaming } from "./stream/hooks";

export type AgentBusyReason = "chat" | "loop" | null;

export interface AgentBusy {
  isBusy: boolean;
  reason: AgentBusyReason;
}

/**
 * Track whether a specific project-scoped agent instance is currently
 * busy from the *user's* perspective — either the main chat SSE is
 * streaming a turn, or the automation loop is running a task against
 * the same agent upstream.
 *
 * This exists because the upstream harness enforces one in-flight turn
 * per agent (`/v1/agents/{id}/...` shared by chat sessions and
 * automatons). Without a combined signal the chat input would keep
 * showing the send arrow while the loop was already holding the agent,
 * and any `UserMessage` would be rejected by the harness with the raw
 * "A turn is currently in progress; send cancel first" error — with no
 * stop icon for the user to cancel.
 */
export function useAgentBusy(params: {
  projectId: string | undefined;
  agentInstanceId: string | undefined;
  streamKey: string;
}): AgentBusy {
  const { projectId, agentInstanceId, streamKey } = params;
  const chatStreaming = useIsStreaming(streamKey);
  const loopActive = useLoopActiveForAgent(projectId, agentInstanceId);

  if (chatStreaming) return { isBusy: true, reason: "chat" };
  if (loopActive) return { isBusy: true, reason: "loop" };
  return { isBusy: false, reason: null };
}

/**
 * Whether the automation loop is currently running a task for a
 * specific agent instance inside a project. Seeded from
 * `/loop/status.active_agent_instances` and kept live via the
 * `LoopStarted` / `LoopStopped` / `LoopFinished` WS events — which
 * stamp the participating agent instance id as `agent_id` (see
 * `parseAuraEvent` in `types/aura-events.ts`).
 */
function useLoopActiveForAgent(
  projectId: string | undefined,
  agentInstanceId: string | undefined,
): boolean {
  const subscribe = useEventStore((s) => s.subscribe);
  const connected = useEventStore((s) => s.connected);
  const [active, setActive] = useState(false);

  const matches = useCallback(
    (evt: { project_id?: string; agent_id?: string }) =>
      !!projectId &&
      !!agentInstanceId &&
      evt.project_id === projectId &&
      evt.agent_id === agentInstanceId,
    [projectId, agentInstanceId],
  );

  const fetchStatus = useCallback(async () => {
    if (!projectId || !agentInstanceId) return false;
    try {
      const res = await api.getLoopStatus(projectId);
      return !!res.active_agent_instances?.includes(agentInstanceId);
    } catch {
      return false;
    }
  }, [projectId, agentInstanceId]);

  useEffect(() => {
    let cancelled = false;
    void fetchStatus().then((next) => {
      if (!cancelled) setActive(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnectedRef.current) {
      void fetchStatus().then(setActive);
    }
    prevConnectedRef.current = connected;
  }, [connected, fetchStatus]);

  useEffect(() => {
    if (!projectId || !agentInstanceId) return;
    const unsubs = [
      subscribe(EventType.LoopStarted, (e) => {
        if (matches(e)) setActive(true);
      }),
      subscribe(EventType.LoopStopped, (e) => {
        if (matches(e)) setActive(false);
      }),
      subscribe(EventType.LoopFinished, (e) => {
        if (matches(e)) setActive(false);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, matches, projectId, agentInstanceId]);

  return active;
}
