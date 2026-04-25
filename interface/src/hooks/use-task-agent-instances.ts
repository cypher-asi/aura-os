import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { AgentInstance, Task } from "../shared/types";

/**
 * Fetches the assigned and completed-by agent instances for a task.
 * Re-fetches when the task's agent instance IDs change.
 */
export function useTaskAgentInstances(
  projectId: string | undefined,
  task: Task,
): { agentInstance: AgentInstance | null; completedByAgent: AgentInstance | null } {
  const [agentInstance, setAgentInstance] = useState<AgentInstance | null>(null);
  const [completedByAgent, setCompletedByAgent] = useState<AgentInstance | null>(null);

  useEffect(() => {
    if (!projectId || !task.assigned_agent_instance_id) {
      setAgentInstance(null);
      return;
    }
    api.getAgentInstance(projectId, task.assigned_agent_instance_id)
      .then(setAgentInstance)
      .catch(() => setAgentInstance(null));
  }, [projectId, task.assigned_agent_instance_id]);

  useEffect(() => {
    if (!projectId || !task.completed_by_agent_instance_id) {
      setCompletedByAgent(null);
      return;
    }
    if (task.completed_by_agent_instance_id === task.assigned_agent_instance_id && agentInstance) {
      setCompletedByAgent(agentInstance);
      return;
    }
    api.getAgentInstance(projectId, task.completed_by_agent_instance_id)
      .then(setCompletedByAgent)
      .catch(() => setCompletedByAgent(null));
  }, [projectId, task.completed_by_agent_instance_id, task.assigned_agent_instance_id, agentInstance]);

  return { agentInstance, completedByAgent };
}
