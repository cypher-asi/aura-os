import { useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useSidekick } from "../../stores/sidekick-store";
import type { AgentInstance } from "../../types";
import { useSidebarSearch } from "../../context/SidebarSearchContext";
import { useLoopStatus } from "../../hooks/use-loop-status";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectListActions } from "../../hooks/use-project-list-actions";

export function useProjectListData() {
  const { projectId, agentInstanceId } = useParams();
  const location = useLocation();
  const sidekick = useSidekick();
  const {
    projects,
    loadingProjects,
    agentsByProject,
    setAgentsByProject,
    refreshProjectAgents,
    openNewProjectModal,
  } = useProjectsList();

  const { query: searchQuery } = useSidebarSearch();
  const { isMobileLayout } = useAuraCapabilities();
  const { automatingProjectId, automatingAgentInstanceId } = useLoopStatus(agentInstanceId);
  const actions = useProjectListActions();
  const [failedIcons, setFailedIcons] = useState<Set<string>>(new Set());

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

  return {
    projectId, agentInstanceId, location, sidekick,
    projects, loadingProjects, agentsByProject, setAgentsByProject,
    refreshProjectAgents, openNewProjectModal,
    searchQuery, isMobileLayout,
    automatingProjectId, automatingAgentInstanceId,
    actions, failedIcons, setFailedIcons,
    projectMap, agentMeta,
  };
}
