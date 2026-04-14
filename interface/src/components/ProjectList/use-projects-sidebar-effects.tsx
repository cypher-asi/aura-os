import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ProjectsPlusButton } from "../ProjectsPlusButton";
import { useAppUIStore } from "../../stores/app-ui-store";
import { mergeAgentIntoProjectAgents } from "../../queries/project-queries";
import { getLastAgent } from "../../utils/storage";
import type { useProjectListData } from "./useProjectListData";
import { getPreferredProjectAgent } from "./project-list-shared";

function useProjectsActionButton(openNewProjectModal: () => void): void {
  const setAction = useAppUIStore((s) => s.setSidebarAction);

  useEffect(() => {
    setAction(
      "projects",
      <ProjectsPlusButton onClick={openNewProjectModal} title="New Project" />,
    );
    return () => setAction("projects", null);
  }, [openNewProjectModal, setAction]);
}

function useRecoveredAgentRefresh(
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

function useAgentInstanceUpdates(
  data: ReturnType<typeof useProjectListData>,
): void {
  useEffect(() => {
    return data.sidekick.onAgentInstanceUpdate((instance) => {
      data.setAgentsByProject((previous) => {
        const existingAgents = previous[instance.project_id];
        if (!existingAgents) return previous;
        if (!existingAgents.some((agent) => agent.agent_instance_id === instance.agent_instance_id)) {
          return previous;
        }
        return {
          ...previous,
          [instance.project_id]: mergeAgentIntoProjectAgents(existingAgents, instance),
        };
      });
    });
  }, [data]);
}

function useProjectRootRedirect(data: ReturnType<typeof useProjectListData>): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!data.projectId || data.agentInstanceId || data.isMobileLayout) return;
    if (data.location.pathname !== `/projects/${data.projectId}`) return;
    if (!(data.projectId in data.agentsByProject)) return;

    const agents = data.agentsByProject[data.projectId];
    if (!agents || agents.length === 0) return;

    const lastAgentId = getLastAgent(data.projectId);
    const targetAgent = getPreferredProjectAgent(agents, lastAgentId);
    if (!targetAgent) return;
    navigate(`/projects/${data.projectId}/agents/${targetAgent.agent_instance_id}`, {
      replace: true,
    });
  }, [data, navigate]);
}

export function useProjectsSidebarEffects(
  data: ReturnType<typeof useProjectListData>,
): void {
  useProjectsActionButton(data.openNewProjectModal);
  useRecoveredAgentRefresh(
    data.projectId,
    data.agentInstanceId,
    data.agentsByProject,
    data.refreshProjectAgents,
  );
  useAgentInstanceUpdates(data);
  useProjectRootRedirect(data);
}
