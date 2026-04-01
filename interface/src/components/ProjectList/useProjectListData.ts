import { useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useSidekickStore } from "../../stores/sidekick-store";
import type { AgentInstance } from "../../types";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useLoopStatus } from "../../hooks/use-loop-status";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectListActions } from "../../hooks/use-project-list-actions";

export function useProjectListData() {
  const { projectId, agentInstanceId } = useParams();
  const location = useLocation();
  const closePreview = useSidekickStore((s) => s.closePreview);
  const onAgentInstanceUpdate = useSidekickStore((s) => s.onAgentInstanceUpdate);
  const streamingAgentInstanceId = useSidekickStore((s) => s.streamingAgentInstanceId);
  const sidekick = useMemo(
    () => ({ closePreview, onAgentInstanceUpdate, streamingAgentInstanceId }),
    [closePreview, onAgentInstanceUpdate, streamingAgentInstanceId],
  );
  const {
    projects,
    loadingProjects,
    agentsByProject,
    setAgentsByProject,
    refreshProjectAgents,
    openNewProjectModal,
  } = useProjectsList();

  const searchQuery = useAppUIStore((s) => s.sidebarQuery);
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
