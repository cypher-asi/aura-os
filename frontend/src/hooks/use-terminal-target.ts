import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { AgentInstance, ProjectId } from "../types";

export type TerminalTargetStatus = "loading" | "ready" | "error";

export interface TerminalTarget {
  remoteAgentId: string | undefined;
  remoteWorkspacePath: string | undefined;
  status: TerminalTargetStatus;
}

interface SelectedAgentLike {
  agent_id: string;
  machine_type: string;
}

interface UseTerminalTargetArgs {
  projectId?: ProjectId;
  agentInstanceId?: string;
  agentId?: string;
  selectedAgent?: SelectedAgentLike | null;
  agentsStatus?: "idle" | "loading" | "ready" | "error";
}

function resolveProjectRemote(instances: AgentInstance[]): { agentId?: string; workspacePath?: string } {
  const remote = instances.find((i) => i.machine_type === "remote");
  return { agentId: remote?.agent_id, workspacePath: remote?.workspace_path ?? undefined };
}

export function useTerminalTarget(args: UseTerminalTargetArgs): TerminalTarget {
  const {
    projectId,
    agentInstanceId,
    agentId,
    selectedAgent,
    agentsStatus,
  } = args;
  const selectedAgentId = selectedAgent?.agent_id;
  const selectedAgentMachineType = selectedAgent?.machine_type;

  const [state, setState] = useState<TerminalTarget>({
    remoteAgentId: undefined,
    remoteWorkspacePath: undefined,
    status: "loading",
  });
  const lastResolvedKeyRef = useRef<string>("");

  const key = useMemo(() => {
    return `${projectId ?? ""}|${agentInstanceId ?? ""}|${agentId ?? ""}`;
  }, [projectId, agentInstanceId, agentId]);

  useEffect(() => {
    if (!projectId && !agentId) {
      lastResolvedKeyRef.current = key;
      setState({ remoteAgentId: undefined, remoteWorkspacePath: undefined, status: "ready" });
      return;
    }

    if (lastResolvedKeyRef.current !== key) {
      setState((prev) => ({ ...prev, status: "loading" }));
    }

    // Project route with explicit agent instance: always resolve terminal target
    // from this exact instance so chat + terminal stay on the same remote agent.
    if (projectId && agentInstanceId) {
      let cancelled = false;
      api
        .getAgentInstance(projectId, agentInstanceId)
        .then((inst) => {
          if (cancelled) return;
          lastResolvedKeyRef.current = key;
          const isRemote = inst.machine_type === "remote";
          setState({
            remoteAgentId: isRemote ? inst.agent_id : undefined,
            remoteWorkspacePath: isRemote ? (inst.workspace_path ?? undefined) : undefined,
            status: "ready",
          });
        })
        .catch(() => {
          if (cancelled) return;
          lastResolvedKeyRef.current = key;
          setState({ remoteAgentId: undefined, remoteWorkspacePath: undefined, status: "error" });
        });

      return () => {
        cancelled = true;
      };
    }

    // Agents app route: resolve from selected agent once agents are loaded.
    if (agentId) {
      if (agentsStatus !== "ready") return;
      if (!selectedAgentId || selectedAgentId !== agentId) return;
      lastResolvedKeyRef.current = key;
      setState({
        remoteAgentId: selectedAgentMachineType === "remote" ? selectedAgentId : undefined,
        remoteWorkspacePath: undefined,
        status: "ready",
      });
      return;
    }

    // Project route without explicit agent instance: best-effort fallback
    // for non-chat project pages.
    if (projectId) {
      let cancelled = false;
      api
        .listAgentInstances(projectId)
        .then((instances) => {
          if (cancelled) return;
          lastResolvedKeyRef.current = key;
          const { agentId: rId, workspacePath } = resolveProjectRemote(instances);
          setState({ remoteAgentId: rId, remoteWorkspacePath: workspacePath, status: "ready" });
        })
        .catch(() => {
          if (cancelled) return;
          lastResolvedKeyRef.current = key;
          setState({ remoteAgentId: undefined, remoteWorkspacePath: undefined, status: "error" });
        });
      return () => {
        cancelled = true;
      };
    }
  }, [agentId, agentInstanceId, agentsStatus, key, projectId, selectedAgentId, selectedAgentMachineType]);

  return state;
}
