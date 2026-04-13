import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AgentInstance, Project, Spec, Task } from "../types";
import { compareSpecs } from "../utils/collections";

export interface ProjectLayoutBundle {
  project: Project;
  specs: Spec[];
  tasks: Task[];
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order_index - b.order_index);
}

export function dedupeProjects(projects: Project[]): Project[] {
  const seen = new Set<string>();
  const next: Project[] = [];
  for (const project of projects) {
    if (seen.has(project.project_id)) continue;
    seen.add(project.project_id);
    next.push(project);
  }
  return next;
}

export const projectQueryKeys = {
  root: ["projects"] as const,
  list: (orgId?: string) => ["projects", "list", orgId ?? "all"] as const,
  agents: (projectId: string) => ["projects", "agents", projectId] as const,
  agentInstance: (projectId: string, agentInstanceId: string) =>
    ["projects", "agent-instance", projectId, agentInstanceId] as const,
  layout: (projectId: string) => ["projects", "layout", projectId] as const,
};

export function projectsQueryOptions(orgId?: string) {
  return queryOptions({
    queryKey: projectQueryKeys.list(orgId),
    queryFn: async () => dedupeProjects(await api.listProjects(orgId)),
    retry: 0,
  });
}

export function projectAgentsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: projectQueryKeys.agents(projectId),
    queryFn: () => api.listAgentInstances(projectId),
    retry: 0,
  });
}

export function projectAgentInstanceQueryOptions(
  projectId: string,
  agentInstanceId: string,
){
  return queryOptions({
    queryKey: projectQueryKeys.agentInstance(projectId, agentInstanceId),
    queryFn: () => api.getAgentInstance(projectId, agentInstanceId),
    retry: 0,
  });
}

export function projectLayoutQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: projectQueryKeys.layout(projectId),
    queryFn: async (): Promise<ProjectLayoutBundle> => {
      const [project, specs, tasks] = await Promise.all([
        api.getProject(projectId),
        api.listSpecs(projectId).catch(() => [] as Spec[]),
        api.listTasks(projectId).catch(() => [] as Task[]),
      ]);

      return {
        project,
        specs: [...specs].sort(compareSpecs),
        tasks: sortTasks(tasks),
      };
    },
    retry: 0,
  });
}

export function mergeAgentIntoProjectAgents(
  agents: AgentInstance[] | undefined,
  nextAgent: AgentInstance,
): AgentInstance[] {
  const currentAgents = agents ?? [];
  const found = currentAgents.some(
    (agent) => agent.agent_instance_id === nextAgent.agent_instance_id,
  );
  if (!found) {
    return [...currentAgents, nextAgent];
  }
  return currentAgents.map((agent) =>
    agent.agent_instance_id === nextAgent.agent_instance_id ? nextAgent : agent,
  );
}
