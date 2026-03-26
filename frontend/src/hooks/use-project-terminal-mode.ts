import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AgentInstance, ProjectId } from "../types";

/**
 * Returns the agent template ID of the first remote agent instance
 * assigned to the project (if any). The terminal panel uses this to
 * decide whether to connect to a VM shell or a local PTY.
 */
export function useProjectTerminalMode(projectId: ProjectId | undefined) {
  const [remoteAgentId, setRemoteAgentId] = useState<string | undefined>();

  useEffect(() => {
    if (!projectId) {
      setRemoteAgentId(undefined);
      return;
    }

    let cancelled = false;

    api
      .listAgentInstances(projectId)
      .then((instances: AgentInstance[]) => {
        if (cancelled) return;
        const remote = instances.find((i) => i.machine_type === "remote");
        setRemoteAgentId(remote?.agent_id);
      })
      .catch(() => {
        if (!cancelled) setRemoteAgentId(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return remoteAgentId;
}
