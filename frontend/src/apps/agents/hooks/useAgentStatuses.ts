import { useState, useEffect, useRef } from "react";
import { api } from "../../../api/client";
import { useEventStore } from "../../../stores/event-store";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { EventType } from "../../../types/aura-events";
import type { Agent } from "../../../types";

const REMOTE_POLL_MS = 30_000;

/**
 * Resolves a live status string for each agent in the list.
 *
 * - Remote agents: polls VM state + listens for RemoteAgentStateChanged events.
 * - All agents: listens for AgentInstanceUpdated events (maps agent_id → latest
 *   instance status) and checks the sidekick streaming flag.
 */
export function useAgentStatuses(agents: Agent[]): Record<string, string> {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const subscribe = useEventStore((s) => s.subscribe);
  const streamingAgentInstanceId = useSidekickStore((s) => s.streamingAgentInstanceId);

  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  useEffect(() => {
    const remoteAgents = agents.filter(
      (a) => a.machine_type === "remote" && a.network_agent_id,
    );

    let cancelled = false;

    const fetchRemote = () => {
      for (const agent of remoteAgents) {
        api.swarm
          .getRemoteAgentState(agent.agent_id)
          .then((vm) => {
            if (cancelled) return;
            setStatuses((prev) => {
              if (prev[agent.agent_id] === vm.state) return prev;
              return { ...prev, [agent.agent_id]: vm.state };
            });
          })
          .catch(() => {});
      }
    };

    if (remoteAgents.length > 0) {
      fetchRemote();
    }
    const interval =
      remoteAgents.length > 0
        ? setInterval(fetchRemote, REMOTE_POLL_MS)
        : undefined;

    const unsubs = [
      subscribe(EventType.RemoteAgentStateChanged, (event) => {
        const aid = event.content?.agent_id;
        if (!aid) return;
        const match = agentsRef.current.find((a) => a.agent_id === aid);
        if (match) {
          setStatuses((prev) => {
            if (prev[aid] === event.content.state) return prev;
            return { ...prev, [aid]: event.content.state };
          });
        }
      }),
      subscribe(EventType.AgentInstanceUpdated, (event) => {
        const inst = event.content?.agent_instance;
        if (!inst) return;
        const match = agentsRef.current.find(
          (a) => a.agent_id === inst.agent_id,
        );
        if (match && match.machine_type !== "remote") {
          setStatuses((prev) => {
            if (prev[inst.agent_id] === inst.status) return prev;
            return { ...prev, [inst.agent_id]: inst.status };
          });
        }
      }),
    ];

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      unsubs.forEach((u) => u());
    };
  }, [agents, subscribe]);

  useEffect(() => {
    if (!streamingAgentInstanceId) return;
    const onUpdate = useSidekickStore.getState().onAgentInstanceUpdate;
    return onUpdate((instance) => {
      const match = agentsRef.current.find(
        (a) => a.agent_id === instance.agent_id,
      );
      if (match) {
        setStatuses((prev) => {
          if (prev[instance.agent_id] === instance.status) return prev;
          return { ...prev, [instance.agent_id]: instance.status };
        });
      }
    });
  }, [streamingAgentInstanceId]);

  return statuses;
}
