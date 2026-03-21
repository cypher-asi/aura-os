import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { api } from "../../api/client";
import { useOrgStore } from "../../stores/org-store";
import type { AgentInstance, Project } from "../../types";
import { ProjectsListContext, type ProjectsListContextValue } from "./ProjectsListContext.shared";

const NEW_PROJECT_MODAL_STORAGE_KEY = "aura:new-project-modal-open";

function dedupeProjects(projects: Project[]) {
  const seen = new Set<string>();
  const next: Project[] = [];

  for (const project of projects) {
    if (seen.has(project.project_id)) continue;
    seen.add(project.project_id);
    next.push(project);
  }

  return next;
}

export function ProjectsListProvider({ children }: { children: ReactNode }) {
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentsByProjectState, setAgentsByProjectState] = useState<Record<string, AgentInstance[]>>({});
  const [loadingAgentsByProject, setLoadingAgentsByProject] = useState<Record<string, boolean>>({});
  const [loadingProjects, setLoadingProjects] = useState(true);
  const refreshRequestId = useRef(0);
  const agentRefreshRequestIds = useRef<Record<string, number>>({});
  const agentsByProjectRef = useRef<Record<string, AgentInstance[]>>({});
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(NEW_PROJECT_MODAL_STORAGE_KEY) === "1";
  });

  const refreshProjects = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    setLoadingProjects(true);
    try {
      const nextProjects = await api.listProjects(activeOrg?.org_id);
      if (refreshRequestId.current === requestId) {
        setProjects(dedupeProjects(nextProjects));
      }
    } catch (error) {
      if (refreshRequestId.current === requestId) {
        console.error("Failed to load projects", error);
      }
    }

    if (refreshRequestId.current === requestId) {
      setLoadingProjects(false);
    }
  }, [activeOrg?.org_id]);

  const setAgentsByProject = useCallback<Dispatch<SetStateAction<Record<string, AgentInstance[]>>>>((update) => {
    setAgentsByProjectState((prev) => {
      const next = typeof update === "function"
        ? update(prev)
        : update;
      agentsByProjectRef.current = next;
      return next;
    });
  }, []);

  const refreshProjectAgents = useCallback(async (projectId: string) => {
    const requestId = (agentRefreshRequestIds.current[projectId] ?? 0) + 1;
    agentRefreshRequestIds.current[projectId] = requestId;
    setLoadingAgentsByProject((prev) => ({ ...prev, [projectId]: true }));
    let result = agentsByProjectRef.current[projectId] ?? [];

    try {
      const nextAgents = await api.listAgentInstances(projectId);
      if (agentRefreshRequestIds.current[projectId] !== requestId) {
        return agentsByProjectRef.current[projectId] ?? result;
      }
      setAgentsByProject((prev) => ({ ...prev, [projectId]: nextAgents }));
      result = nextAgents;
    } catch (error) {
      if (agentRefreshRequestIds.current[projectId] === requestId) {
        console.error("Failed to load project agents", error);
        setAgentsByProject((prev) => (projectId in prev ? prev : { ...prev, [projectId]: [] }));
      }
      result = agentsByProjectRef.current[projectId] ?? [];
    } finally {
      if (agentRefreshRequestIds.current[projectId] === requestId) {
        setLoadingAgentsByProject((prev) => ({ ...prev, [projectId]: false }));
      }
    }

    return result;
  }, [setAgentsByProject]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    const toFetch = projects.filter(p => !(p.project_id in agentsByProjectRef.current));
    if (toFetch.length === 0) return;

    let cancelled = false;
    const ids = toFetch.map(p => p.project_id);
    setLoadingAgentsByProject(prev => {
      const next = { ...prev };
      for (const id of ids) next[id] = true;
      return next;
    });

    Promise.all(
      toFetch.map(p =>
        api.listAgentInstances(p.project_id)
          .then(agents => ({ projectId: p.project_id, agents }))
          .catch(() => ({ projectId: p.project_id, agents: [] as AgentInstance[] }))
      )
    ).then(results => {
      if (cancelled) return;
      const batch: Record<string, AgentInstance[]> = {};
      for (const { projectId, agents } of results) {
        batch[projectId] = agents;
      }
      setAgentsByProject(prev => ({ ...prev, ...batch }));
      setLoadingAgentsByProject(prev => {
        const next = { ...prev };
        for (const id of ids) next[id] = false;
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [projects, setAgentsByProject]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (newProjectModalOpen) {
      window.sessionStorage.setItem(NEW_PROJECT_MODAL_STORAGE_KEY, "1");
    } else {
      window.sessionStorage.removeItem(NEW_PROJECT_MODAL_STORAGE_KEY);
    }
  }, [newProjectModalOpen]);

  const openNewProjectModal = useCallback(() => setNewProjectModalOpen(true), []);
  const closeNewProjectModal = useCallback(() => setNewProjectModalOpen(false), []);

  const recentProjects = useMemo(
    () => [...projects]
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
      .slice(0, 3),
    [projects],
  );

  const mostRecentProject = useMemo(
    () => recentProjects[0] ?? null,
    [recentProjects],
  );

  const value = useMemo<ProjectsListContextValue>(
    () => ({
      projects,
      loadingProjects,
      setProjects,
      refreshProjects,
      agentsByProject: agentsByProjectState,
      loadingAgentsByProject,
      setAgentsByProject,
      refreshProjectAgents,
      recentProjects,
      mostRecentProject,
      newProjectModalOpen,
      openNewProjectModal,
      closeNewProjectModal,
    }),
    [
      projects,
      loadingProjects,
      refreshProjects,
      agentsByProjectState,
      loadingAgentsByProject,
      setAgentsByProject,
      refreshProjectAgents,
      recentProjects,
      mostRecentProject,
      newProjectModalOpen,
      openNewProjectModal,
      closeNewProjectModal,
    ],
  );

  return (
    <ProjectsListContext.Provider value={value}>
      {children}
    </ProjectsListContext.Provider>
  );
}
