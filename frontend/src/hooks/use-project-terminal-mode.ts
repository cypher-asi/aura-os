import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AgentInstance, ProjectId } from "../types";

interface ProjectTerminalMode {
  remoteAgentId: string | undefined;
  resolved: boolean;
}

/**
 * Returns the agent template ID of the first remote agent instance
 * assigned to the project (if any). `resolved` is false until the
 * check completes so callers can avoid spawning a terminal prematurely.
 */
export function useProjectTerminalMode(projectId: ProjectId | undefined): ProjectTerminalMode {
  const [state, setState] = useState<ProjectTerminalMode>({
    remoteAgentId: undefined,
    resolved: false,
  });

  useEffect(() => {
    if (!projectId) {
      setState({ remoteAgentId: undefined, resolved: true });
      return;
    }

    setState((s) => (s.resolved ? { ...s, resolved: false } : s));

    let cancelled = false;

    api
      .listAgentInstances(projectId)
      .then((instances: AgentInstance[]) => {
        if (cancelled) return;
        const remote = instances.find((i) => i.machine_type === "remote");
        setState({ remoteAgentId: remote?.agent_id, resolved: true });
      })
      .catch(() => {
        if (!cancelled) setState({ remoteAgentId: undefined, resolved: true });
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return state;
}
