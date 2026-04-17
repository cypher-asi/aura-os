import { useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useChatHandoffStore } from "../../stores/chat-handoff-store";
import type { AgentInstance } from "../../types";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useActiveAppId } from "../../hooks/use-active-app";
import { useLoopStatus } from "../../hooks/use-loop-status";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectListActions } from "../../hooks/use-project-list-actions";

export function useProjectListData(appIdOverride?: string) {
  const { projectId, agentInstanceId } = useParams();
  const location = useLocation();
  const activeAppId = useActiveAppId();
  const appId = appIdOverride ?? activeAppId;
  const sidekick = useSidekickStore(
    useShallow((s) => ({
      closePreview: s.closePreview,
      onAgentInstanceUpdate: s.onAgentInstanceUpdate,
      streamingAgentInstanceId: s.streamingAgentInstanceId,
    })),
  );
  const {
    projects,
    loadingProjects,
    saveProjectOrder,
    agentsByProject,
    setAgentsByProject,
    refreshProjectAgents,
    openNewProjectModal,
  } = useProjectsList();

  const searchQuery = useAppUIStore((s) => s.sidebarQueries[appId] ?? "");
  const { isMobileLayout } = useAuraCapabilities();
  const { automatingProjectId, automatingAgentInstanceId } = useLoopStatus(agentInstanceId);
  const actions = useProjectListActions();
  const pendingCreateAgentHandoff = useChatHandoffStore((state) => state.pendingCreateAgentHandoff);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.project_id, p])),
    [projects],
  );

  const agentMeta = useMemo(() => {
    const map = new Map<string, { projectId: string; agent: AgentInstance }>();
    for (const [pid, agents] of Object.entries(agentsByProject)) {
      for (const s of agents) {
        map.set(s.agent_instance_id, { projectId: pid, agent: s });
      }
    }
    return map;
  }, [agentsByProject]);

  return useMemo(
    () => ({
      projectId,
      agentInstanceId,
      location,
      sidekick,
      projects,
      loadingProjects,
      saveProjectOrder,
      agentsByProject,
      setAgentsByProject,
      refreshProjectAgents,
      openNewProjectModal,
      searchQuery,
      isMobileLayout,
      automatingProjectId,
      automatingAgentInstanceId,
      pendingCreateAgentHandoff,
      actions,
      projectMap,
      agentMeta,
    }),
    [
      projectId,
      agentInstanceId,
      location,
      sidekick,
      projects,
      loadingProjects,
      saveProjectOrder,
      agentsByProject,
      setAgentsByProject,
      refreshProjectAgents,
      openNewProjectModal,
      searchQuery,
      isMobileLayout,
      automatingProjectId,
      automatingAgentInstanceId,
      pendingCreateAgentHandoff,
      actions,
      projectMap,
      agentMeta,
    ],
  );
}
