import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentInstance, ProjectId } from "../shared/types";
import {
  projectAgentInstanceQueryOptions,
  projectAgentsQueryOptions,
} from "../queries/project-queries";

export type TerminalTargetStatus = "loading" | "ready" | "error";

export interface TerminalTarget {
  remoteAgentId: string | undefined;
  remoteAgentInstanceId: string | undefined;
  localAgentInstanceId: string | undefined;
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
): {
  remoteAgentId?: string;
  remoteAgentInstanceId?: string;
  localAgentInstanceId?: string;
  remoteWorkspacePath?: string;
  workspacePath?: string;
} {
  const remoteWithWorkspace = instances.find((i) => (
    i.machine_type === "remote" && Boolean(i.workspace_path?.trim())
  ));
  if (remoteWithWorkspace) {
    const workspacePath = remoteWithWorkspace.workspace_path ?? undefined;
    return {
      remoteAgentId: remoteWithWorkspace.agent_id,
      remoteAgentInstanceId: remoteWithWorkspace.agent_instance_id,
      localAgentInstanceId: undefined,
      remoteWorkspacePath: workspacePath,
      workspacePath,
    };
  }

  const local = instances.find((i) => {
    const workspacePath = i.workspace_path?.trim();
    return Boolean(workspacePath);
  });
  const workspacePath = local?.workspace_path ?? undefined;
  if (workspacePath) {
    return {
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      localAgentInstanceId: local?.agent_instance_id,
      remoteWorkspacePath: undefined,
      workspacePath,
    };
  }

  const remote = instances.find((i) => i.machine_type === "remote");
  if (remote) {
    return {
      remoteAgentId: remote.agent_id,
      remoteAgentInstanceId: remote.agent_instance_id,
      localAgentInstanceId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
    };
  }

  const hostedLocal = instances.find((i) => i.machine_type !== "remote");
  return {
    remoteAgentId: undefined,
    remoteAgentInstanceId: undefined,
    localAgentInstanceId: hostedLocal?.agent_instance_id,
    remoteWorkspacePath: undefined,
    workspacePath: undefined,
  };
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

  const syncState = useMemo<TerminalTarget | null>(() => {
    if (!projectId && !agentId) {
      return {
        remoteAgentId: undefined,
        remoteAgentInstanceId: undefined,
        localAgentInstanceId: undefined,
        remoteWorkspacePath: undefined,
        workspacePath: undefined,
        status: "ready",
      };
    }

    if (agentId && agentsStatus === "ready" && selectedAgentId === agentId) {
      return {
        remoteAgentId: selectedAgentMachineType === "remote" ? selectedAgentId : undefined,
        remoteAgentInstanceId: undefined,
        localAgentInstanceId: undefined,
        remoteWorkspacePath: undefined,
        workspacePath: undefined,
        status: "ready",
      };
    }

    return null;
  }, [agentId, agentsStatus, projectId, selectedAgentId, selectedAgentMachineType]);

  const agentInstanceQuery = useQuery({
    ...(projectId && agentInstanceId
      ? projectAgentInstanceQueryOptions(projectId, agentInstanceId)
      : projectAgentInstanceQueryOptions("", "")),
    enabled: Boolean(projectId && agentInstanceId) && !syncState,
  });

  const projectAgentsQuery = useQuery({
    ...(projectId ? projectAgentsQueryOptions(projectId) : projectAgentsQueryOptions("")),
    enabled: Boolean(projectId) && !agentInstanceId && !syncState,
  });

  if (syncState) {
    return syncState;
  }

  if (projectId && agentInstanceId) {
    if (agentInstanceQuery.isError) {
      return {
        remoteAgentId: undefined,
        remoteAgentInstanceId: undefined,
        localAgentInstanceId: undefined,
        remoteWorkspacePath: undefined,
        workspacePath: undefined,
        status: "error",
      };
    }

    if (!agentInstanceQuery.data) {
      return {
        remoteAgentId: undefined,
        remoteAgentInstanceId: undefined,
        localAgentInstanceId: undefined,
        remoteWorkspacePath: undefined,
        workspacePath: undefined,
        status: "loading",
      };
    }

    const isRemote = agentInstanceQuery.data.machine_type === "remote";
    return {
      remoteAgentId: isRemote ? agentInstanceQuery.data.agent_id : undefined,
      remoteAgentInstanceId: isRemote
        ? agentInstanceQuery.data.agent_instance_id
        : undefined,
      localAgentInstanceId: isRemote
        ? undefined
        : agentInstanceQuery.data.agent_instance_id,
      remoteWorkspacePath: isRemote
        ? (agentInstanceQuery.data.workspace_path ?? undefined)
        : undefined,
      workspacePath: agentInstanceQuery.data.workspace_path ?? undefined,
      status: "ready",
    };
  }

  if (projectId) {
    if (projectAgentsQuery.isError) {
      return {
        remoteAgentId: undefined,
        remoteAgentInstanceId: undefined,
        localAgentInstanceId: undefined,
        remoteWorkspacePath: undefined,
        workspacePath: undefined,
        status: "error",
      };
    }

    if (!projectAgentsQuery.data) {
      return {
        remoteAgentId: undefined,
        remoteAgentInstanceId: undefined,
        localAgentInstanceId: undefined,
        remoteWorkspacePath: undefined,
        workspacePath: undefined,
        status: "loading",
      };
    }

    const resolvedWorkspace = resolveProjectWorkspace(projectAgentsQuery.data);
    return {
      remoteAgentId: resolvedWorkspace.remoteAgentId,
      remoteAgentInstanceId: resolvedWorkspace.remoteAgentInstanceId,
      localAgentInstanceId: resolvedWorkspace.localAgentInstanceId,
      remoteWorkspacePath: resolvedWorkspace.remoteWorkspacePath,
      workspacePath: resolvedWorkspace.workspacePath,
      status: "ready",
    };
  }

  if (agentId) {
    return {
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      localAgentInstanceId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: undefined,
      status: agentsStatus === "error" ? "error" : "loading",
    };
  }

  const emptyState: TerminalTargetState = {
    remoteAgentId: undefined,
    remoteAgentInstanceId: undefined,
    localAgentInstanceId: undefined,
    remoteWorkspacePath: undefined,
    workspacePath: undefined,
    status: "ready",
    resolvedKey: "",
  };
  return emptyState;
}
