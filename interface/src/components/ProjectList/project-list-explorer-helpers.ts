import type { useProjectListData } from "./useProjectListData";

export function isProjectNestedPath(
  pathname: string,
  hasSelectedAgent: boolean,
): boolean {
  return (
    hasSelectedAgent ||
    pathname.endsWith("/execution") ||
    pathname.endsWith("/work") ||
    pathname.endsWith("/files") ||
    pathname.endsWith("/stats") ||
    pathname.endsWith("/process") ||
    pathname.endsWith("/tasks") ||
    pathname.endsWith("/agent") ||
    /\/agents\/[^/]+(?:\/details)?$/.test(pathname)
  );
}

export function registerProjectExplorerAgents(
  agentsByProject: ReturnType<typeof useProjectListData>["agentsByProject"],
  registerAgents: (agents: { id: string; machineType: string }[]) => void,
  registerRemoteAgents: (agents: { agent_id: string }[]) => void,
): void {
  const allAgents: { id: string; machineType: string }[] = [];
  const remoteAgents: { agent_id: string }[] = [];

  for (const agents of Object.values(agentsByProject)) {
    for (const agent of agents) {
      allAgents.push({ id: agent.agent_id, machineType: agent.machine_type });
      allAgents.push({
        id: agent.agent_instance_id,
        machineType: agent.machine_type,
      });
      if (agent.machine_type === "remote") {
        remoteAgents.push({ agent_id: agent.agent_id });
      }
    }
  }

  if (allAgents.length > 0) {
    registerAgents(allAgents);
  }
  if (remoteAgents.length > 0) {
    registerRemoteAgents(remoteAgents);
  }
}
