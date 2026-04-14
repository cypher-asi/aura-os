import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  useProjectsListStore,
  getRecentProjects,
} from "../../stores/projects-list-store";

export function useProjectsList() {
  const store = useProjectsListStore(
    useShallow((s) => ({
      projects: s.projects,
      loadingProjects: s.loadingProjects,
      setProjects: s.setProjects,
      saveProjectOrder: s.saveProjectOrder,
      refreshProjects: s.refreshProjects,
      agentsByProject: s.agentsByProject,
      loadingAgentsByProject: s.loadingAgentsByProject,
      setAgentsByProject: s.setAgentsByProject,
      refreshProjectAgents: s.refreshProjectAgents,
      newProjectModalOpen: s.newProjectModalOpen,
      openNewProjectModal: s.openNewProjectModal,
      closeNewProjectModal: s.closeNewProjectModal,
    })),
  );

  const recentProjects = useMemo(
    () => getRecentProjects(store.projects),
    [store.projects],
  );

  const mostRecentProject = recentProjects[0] ?? null;

  return {
    ...store,
    recentProjects,
    mostRecentProject,
  };
}
