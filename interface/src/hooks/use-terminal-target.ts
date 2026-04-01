import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { AgentInstance, ProjectId } from "../types";

export type TerminalTargetStatus = "loading" | "ready" | "error";

export interface TerminalTarget {
  remoteAgentId: string | undefined;
  remoteWorkspacePath: string | undefined;
  workspacePath: string | undefined;
  status: TerminalTargetStatus;
}

interface TerminalTargetState extends TerminalTarget {
  resolvedKey: string;
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

function resolveProjectWorkspace(
  instances: AgentInstance[],
): { remoteAgentId?: string; remoteWorkspacePath?: string; workspacePath?: string } {
  const remote = instances.find((i) => i.machine_type === "remote");
  if (remote) {
    const workspacePath = remote.workspace_path ?? undefined;
    return {
      remoteAgentId: remote.agent_id,
      remoteWorkspacePath: workspacePath,
      workspacePath,
    };
  }

  const local = instances.find((i) => {
    const workspacePath = i.workspace_path?.trim();
    return Boolean(workspacePath);
  });
  const workspacePath = local?.workspace_path ?? undefined;
  return { remoteAgentId: undefined, remoteWorkspacePath: undefined, workspacePath };
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

  const [state, setState] = useState<TerminalTargetState>({
    remoteAgentId: undefined,
    remoteWorkspacePath: undefined,
    workspacePath: undefined,
    status: "loading",
    resolvedKey: "",
  });

  const key = useMemo(() => {
    return `${projectId ?? ""}|${agentInstanceId ?? ""}|${agentId ?? ""}`;
  }, [projectId, agentInstanceId, agentId]);

  const syncState = useMemo<TerminalTarget | null>(() => {
    if (!projectId && !agentId) {
      return {
        remoteAgentId: undefined,
        remoteWorkspacePath: undefined,
        workspacePath: undefined,
        status: "ready",
      };
    }

    if (agentId && agentsStatus === "ready" && selectedAgentId === agentId) {
      return {
        remoteAgentId: selectedAgentMachineType === "remote" ? selectedAgentId : undefined,
        remoteWorkspacePath: undefined,
        workspacePath: undefined,
        status: "ready",
      };
    }

    return null;
  }, [agentId, agentsStatus, projectId, selectedAgentId, selectedAgentMachineType]);

  useEffect(() => {
    if (syncState) {
      return;
    }

    // Project route with explicit agent instance: always resolve terminal target
    // from this exact instance so chat + terminal stay on the same remote agent.
    if (projectId && agentInstanceId) {
      let cancelled = false;
      api
        .getAgentInstance(projectId, agentInstanceId)
        .then((inst) => {
          if (cancelled) return;
          const isRemote = inst.machine_type === "remote";
          setState({
            remoteAgentId: isRemote ? inst.agent_id : undefined,
            remoteWorkspacePath: isRemote ? (inst.workspace_path ?? undefined) : undefined,
            workspacePath: inst.workspace_path ?? undefined,
            status: "ready",
            resolvedKey: key,
          });
        })
        .catch(() => {
          if (cancelled) return;
          setState({
            remoteAgentId: undefined,
            remoteWorkspacePath: undefined,
            workspacePath: undefined,
            status: "error",
            resolvedKey: key,
          });
        });

      return () => {
        cancelled = true;
      };
    }

    // Agents app route: resolve from selected agent once agents are loaded.
    // Project route without explicit agent instance: best-effort fallback
    // for non-chat project pages.
    if (projectId) {
      let cancelled = false;
      api
        .listAgentInstances(projectId)
        .then((instances) => {
          if (cancelled) return;
          const { remoteAgentId, remoteWorkspacePath, workspacePath } =
            resolveProjectWorkspace(instances);
          setState({
            remoteAgentId,
            remoteWorkspacePath,
            workspacePath,
            status: "ready",
            resolvedKey: key,
          });
        })
        .catch(() => {
          if (cancelled) return;
          setState({
            remoteAgentId: undefined,
            remoteWorkspacePath: undefined,
            workspacePath: undefined,
            status: "error",
            resolvedKey: key,
          });
        });
      return () => {
        cancelled = true;
      };
    }
  }, [agentId, agentInstanceId, key, projectId, syncState]);

  if (syncState) {
    return syncState;
  }

  if (state.resolvedKey !== key) {
    return { ...state, status: "loading" };
  }

  return state;
}
