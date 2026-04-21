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

function isTerminalTaskStatus(status: Task["status"] | undefined): boolean {
  return status === "done" || status === "failed";
}

// Guard the react-query layout cache against stale `task_saved` broadcasts
// that can arrive after the client already knows a task is terminal. Without
// this, a late snapshot with `in_progress` silently reverts a Done task in
// the cache, which then feeds `initialTasks` into the Sidekick TaskList on
// its next mount. Mirrors the guard in `useTaskListData`, `kanban-store`, and
// `sidekick-store`.
function preserveTerminalStatus(existing: Task | undefined, incoming: Task): Task {
  if (!existing) return incoming;
  if (!isTerminalTaskStatus(existing.status)) return incoming;
  if (isTerminalTaskStatus(incoming.status)) return incoming;
  return {
    ...incoming,
    status: existing.status,
    execution_notes: existing.execution_notes ?? incoming.execution_notes,
    files_changed: existing.files_changed ?? incoming.files_changed,
  };
}

function upsertById<T, K extends keyof T>(
  items: T[],
  item: T,
  idKey: K,
): T[] {
  const next = [...items];
  const index = next.findIndex((candidate) => candidate[idKey] === item[idKey]);
  if (index === -1) {
    next.push(item);
  } else {
    next[index] = item;
  }
  return next;
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

export function mergeSpecIntoProjectLayout(
  current: ProjectLayoutBundle | undefined,
  spec: Spec,
): ProjectLayoutBundle | undefined {
  if (!current) return current;
  return {
    ...current,
    specs: upsertById(current.specs, spec, "spec_id").sort(compareSpecs),
  };
}

export function mergeTaskIntoProjectLayout(
  current: ProjectLayoutBundle | undefined,
  task: Task,
): ProjectLayoutBundle | undefined {
  if (!current) return current;
  const existing = current.tasks.find((t) => t.task_id === task.task_id);
  const effective = preserveTerminalStatus(existing, task);
  return {
    ...current,
    tasks: sortTasks(upsertById(current.tasks, effective, "task_id")),
  };
}

// Drop a spec from the layout cache after a successful delete so every view
// reading `initialSpecs` (Sidekick SpecList/TaskList, mobile work/tasks views,
// etc.) reflects the removal immediately instead of waiting for a full page
// refetch.
export function removeSpecFromProjectLayout(
  current: ProjectLayoutBundle | undefined,
  specId: string,
): ProjectLayoutBundle | undefined {
  if (!current) return current;
  const nextSpecs = current.specs.filter((s) => s.spec_id !== specId);
  if (nextSpecs.length === current.specs.length) return current;
  return { ...current, specs: nextSpecs };
}

// Drop a task from the layout cache after a successful delete so every view
// reading `initialTasks` reflects the removal immediately.
export function removeTaskFromProjectLayout(
  current: ProjectLayoutBundle | undefined,
  taskId: string,
): ProjectLayoutBundle | undefined {
  if (!current) return current;
  const nextTasks = current.tasks.filter((t) => t.task_id !== taskId);
  if (nextTasks.length === current.tasks.length) return current;
  return { ...current, tasks: nextTasks };
}

// Apply an authoritative status transition (from `task_started` /
// `task_completed` / `task_failed` / `task_became_ready` WS events) to the
// layout cache without waiting for a follow-up `task_saved` snapshot. Matches
// the patch shape used by `useTaskListData.updateTaskStatus` so the Sidekick
// TaskList shows the right state on its next mount.
//
// No terminal-preservation guard here: these events are the source of truth
// for status transitions, including legitimate retries that resurrect a
// previously-failed task (backend retry flow is `failed -> ready ->
// in_progress`, see `retry_task` in `crates/aura-os-tasks/src/task_service.rs`).
// Snapshot merges via `mergeTaskIntoProjectLayout` still apply the guard to
// resist stale `task_saved` broadcasts.
export function patchTaskStatusInProjectLayout(
  current: ProjectLayoutBundle | undefined,
  taskId: string,
  patch: Partial<Task>,
): ProjectLayoutBundle | undefined {
  if (!current) return current;
  const index = current.tasks.findIndex((t) => t.task_id === taskId);
  if (index === -1) return current;
  const existing = current.tasks[index];
  const nextTasks = [...current.tasks];
  nextTasks[index] = { ...existing, ...patch };
  return { ...current, tasks: sortTasks(nextTasks) };
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
  _requestStartedAtMs: number | undefined,
): boolean {
  return agent.status === "archived";
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
      incomingUpdate.status !== "archived";
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
