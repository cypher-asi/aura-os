import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { api } from "../../api/client";
import { useOrg } from "../../context/OrgContext";
import type { Project } from "../../types";

const NEW_PROJECT_MODAL_STORAGE_KEY = "aura:new-project-modal-open";

interface ProjectsListContextValue {
  projects: Project[];
  loadingProjects: boolean;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  refreshProjects: () => Promise<void>;
  recentProjects: Project[];
  mostRecentProject: Project | null;
  newProjectModalOpen: boolean;
  openNewProjectModal: () => void;
  closeNewProjectModal: () => void;
}

const ProjectsListContext = createContext<ProjectsListContextValue | null>(null);

export function ProjectsListProvider({ children }: { children: ReactNode }) {
  const { activeOrg } = useOrg();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const refreshRequestId = useRef(0);
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(NEW_PROJECT_MODAL_STORAGE_KEY) === "1";
  });

  const refreshProjects = useCallback(async () => {
    const requestId = ++refreshRequestId.current;
    setLoadingProjects(true);
    try {
      const nextProjects = await api.listProjects(activeOrg?.org_id);
      if (refreshRequestId.current !== requestId) return;
      setProjects(nextProjects);
    } catch (error) {
      if (refreshRequestId.current !== requestId) return;
      console.error("Failed to load projects", error);
    } finally {
      if (refreshRequestId.current !== requestId) return;
      setLoadingProjects(false);
    }
  }, [activeOrg?.org_id]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

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

export function useProjectsList() {
  const context = useContext(ProjectsListContext);
  if (!context) {
    throw new Error("useProjectsList must be used within ProjectsListProvider");
  }
  return context;
}
