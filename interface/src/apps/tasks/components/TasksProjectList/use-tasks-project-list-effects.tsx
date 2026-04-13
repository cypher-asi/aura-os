import { useEffect, useRef } from "react";
import type { useProjectListData } from "../../../../components/ProjectList/useProjectListData";
import { ProjectsPlusButton } from "../../../../components/ProjectsPlusButton";
import { useAppUIStore } from "../../../../stores/app-ui-store";

function useTasksSidebarAction(openNewProjectModal: () => void): void {
  const setAction = useAppUIStore((s) => s.setSidebarAction);

  useEffect(() => {
    setAction(
      "tasks",
      <ProjectsPlusButton onClick={openNewProjectModal} title="New Project" />,
    );
    return () => setAction("tasks", null);
  }, [openNewProjectModal, setAction]);
}

function useRecoveredTaskAgents(
  projectId: string | null | undefined,
  agentInstanceId: string | null | undefined,
  agentsByProject: ReturnType<typeof useProjectListData>["agentsByProject"],
  refreshProjectAgents: (projectId: string) => Promise<unknown>,
): void {
  const recoveredAgentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    if (!(projectId in agentsByProject)) {
      void refreshProjectAgents(projectId);
      return;
    }
    if (!agentInstanceId) return;

    const cachedAgents = agentsByProject[projectId] ?? [];
    if (cachedAgents.some((agent) => agent.agent_instance_id === agentInstanceId)) {
      recoveredAgentRef.current = null;
      return;
    }
    if (recoveredAgentRef.current === agentInstanceId) return;
    recoveredAgentRef.current = agentInstanceId;
    void refreshProjectAgents(projectId);
  }, [agentInstanceId, agentsByProject, projectId, refreshProjectAgents]);
}

function useTaskAgentInstanceUpdates(
  data: ReturnType<typeof useProjectListData>,
): void {
  useEffect(() => {
    return data.sidekick.onAgentInstanceUpdate((instance) => {
      data.setAgentsByProject((previous) => {
        const existingAgents = previous[instance.project_id];
        if (!existingAgents) return previous;
        return {
          ...previous,
          [instance.project_id]: existingAgents.map((agent) =>
            agent.agent_instance_id === instance.agent_instance_id
              ? {
                  ...agent,
                  name: instance.name,
                  status: instance.status,
                  updated_at: instance.updated_at,
                }
              : agent,
          ),
        };
      });
    });
  }, [data]);
}

export function useTasksProjectListEffects(
  data: ReturnType<typeof useProjectListData>,
): void {
  useTasksSidebarAction(data.openNewProjectModal);
  useRecoveredTaskAgents(
    data.projectId,
    data.agentInstanceId,
    data.agentsByProject,
    data.refreshProjectAgents,
  );
  useTaskAgentInstanceUpdates(data);
}
