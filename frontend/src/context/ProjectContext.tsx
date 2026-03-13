import { createContext, useContext } from "react";
import type { Project } from "../types";

export interface ProjectActions {
  project: Project;
  setProject: (p: Project) => void;
  genLoading: boolean;
  extractLoading: boolean;
  message: string;
  handleGenerateSpecs: () => void;
  handleStopGeneration: () => void;
  handleExtractTasks: () => void;
  handleArchive: () => void;
  navigateToExecution: () => void;
}

const ProjectContext = createContext<ProjectActions | null>(null);

export const ProjectProvider = ProjectContext.Provider;

export function useProjectContext(): ProjectActions | null {
  return useContext(ProjectContext);
}
