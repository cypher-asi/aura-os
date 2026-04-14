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

export type AgentInstanceUpdate =
  Partial<AgentInstance> &
  Pick<AgentInstance, "agent_instance_id" | "project_id">;

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function compareUpdatedAt(
  currentUpdatedAt: string | null | undefined,
  incomingUpdatedAt: string | null | undefined,
): -1 | 0 | 1 | null {
  const current = parseTimestamp(currentUpdatedAt);
  const incoming = parseTimestamp(incomingUpdatedAt);
  if (current === null || incoming === null) return null;
  if (incoming < current) return -1;
  if (incoming > current) return 1;
  return 0;
}

function shouldPreserveMissingArchivedAgent(
  agent: AgentInstance,
  requestStartedAtMs: number | undefined,
): boolean {
  if (agent.status !== "archived" || requestStartedAtMs === undefined) {
    return false;
  }
  const updatedAtMs = parseTimestamp(agent.updated_at);
  return updatedAtMs !== null && updatedAtMs >= requestStartedAtMs;
}

export function mergeAgentUpdate(
  currentAgent: AgentInstance,
  incomingUpdate: AgentInstanceUpdate,
): AgentInstance {
  const updatedAtComparison = compareUpdatedAt(
    currentAgent.updated_at,
    incomingUpdate.updated_at,
  );
  const nextAgent = { ...currentAgent } as AgentInstance;

  for (const [key, value] of Object.entries(incomingUpdate)) {
    if (value === undefined || key === "status" || key === "updated_at") {
      continue;
    }
    if (updatedAtComparison === -1) {
      continue;
    }
    (nextAgent as unknown as Record<string, unknown>)[key] = value;
  }

  if (incomingUpdate.updated_at !== undefined && updatedAtComparison !== -1) {
    nextAgent.updated_at = incomingUpdate.updated_at;
  }

  if (incomingUpdate.status !== undefined) {
    const preserveArchivedStatus =
      currentAgent.status === "archived" &&
      incomingUpdate.status !== "archived" &&
      updatedAtComparison !== 1;
    if (!preserveArchivedStatus && updatedAtComparison !== -1) {
      nextAgent.status = incomingUpdate.status;
    }
  }

  return nextAgent;
}

export function mergeAgentIntoProjectAgents(
  agents: AgentInstance[] | undefined,
  nextAgent: AgentInstanceUpdate,
): AgentInstance[] {
  const currentAgents = agents ?? [];
  const found = currentAgents.some(
    (agent) => agent.agent_instance_id === nextAgent.agent_instance_id,
  );
  if (!found) {
    return [...currentAgents, nextAgent as AgentInstance];
  }
  return currentAgents.map((agent) =>
    agent.agent_instance_id === nextAgent.agent_instance_id
      ? mergeAgentUpdate(agent, nextAgent)
      : agent,
  );
}

export function mergeProjectAgentsSnapshot(
  currentAgents: AgentInstance[] | undefined,
  incomingAgents: AgentInstance[],
  options: { requestStartedAtMs?: number } = {},
): AgentInstance[] {
  const existingAgents = currentAgents ?? [];
  const currentAgentsById = new Map(
    existingAgents.map((agent) => [agent.agent_instance_id, agent] as const),
  );
  const incomingAgentIds = new Set(incomingAgents.map((agent) => agent.agent_instance_id));
  const mergedAgents = incomingAgents.map((incomingAgent) => {
    const currentAgent = currentAgentsById.get(incomingAgent.agent_instance_id);
    return currentAgent
      ? mergeAgentUpdate(currentAgent, incomingAgent)
      : incomingAgent;
  });

  for (const currentAgent of existingAgents) {
    if (incomingAgentIds.has(currentAgent.agent_instance_id)) {
      continue;
    }
    if (!shouldPreserveMissingArchivedAgent(currentAgent, options.requestStartedAtMs)) {
      continue;
    }
    mergedAgents.push(currentAgent);
  }

  return mergedAgents;
}
