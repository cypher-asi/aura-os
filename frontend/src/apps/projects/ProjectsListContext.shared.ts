import { createContext, type Dispatch, type SetStateAction } from "react";
import type { AgentInstance, Project } from "../../types";

export interface ProjectsListContextValue {
  projects: Project[];
  loadingProjects: boolean;
  setProjects: Dispatch<SetStateAction<Project[]>>;
  refreshProjects: () => Promise<void>;
  agentsByProject: Record<string, AgentInstance[]>;
  loadingAgentsByProject: Record<string, boolean>;
  setAgentsByProject: Dispatch<SetStateAction<Record<string, AgentInstance[]>>>;
  refreshProjectAgents: (projectId: string) => Promise<AgentInstance[]>;
  recentProjects: Project[];
  mostRecentProject: Project | null;
  newProjectModalOpen: boolean;
  openNewProjectModal: () => void;
  closeNewProjectModal: () => void;
}

export const ProjectsListContext = createContext<ProjectsListContextValue | null>(null);
