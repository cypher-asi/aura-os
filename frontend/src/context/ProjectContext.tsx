import { createContext, useContext, useState, useCallback, type ReactNode, type SetStateAction } from "react";
import type { Project, Spec, Task } from "../types";

export interface ProjectActions {
  project: Project;
  setProject: (update: SetStateAction<Project>) => void;
  message: string;
  handleArchive: () => void;
  navigateToExecution: () => void;
  initialSpecs: Spec[];
  initialTasks: Task[];
}

interface ProjectContextValue {
  actions: ProjectActions | null;
  register: (actions: ProjectActions) => void;
  unregister: () => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  actions: null,
  register: () => {},
  unregister: () => {},
});

export function ProjectContextProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ProjectActions | null>(null);

  const register = useCallback((a: ProjectActions) => setActions(a), []);
  const unregister = useCallback(() => setActions(null), []);

  return (
    <ProjectContext.Provider value={{ actions, register, unregister }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext(): ProjectActions | null {
  return useContext(ProjectContext).actions;
}

export function useProjectRegister() {
  const { register, unregister } = useContext(ProjectContext);
  return { register, unregister };
}
