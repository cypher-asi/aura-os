import { create } from "zustand";
import type { SetStateAction } from "react";
import type { Project, Spec, Task } from "../shared/types";

export interface ProjectActions {
  project: Project;
  setProject: (update: SetStateAction<Project>) => void;
  message: string;
  handleArchive: () => void;
  navigateToExecution: () => void;
  initialSpecs: Spec[];
  initialTasks: Task[];
}

interface ProjectActionState {
  actions: ProjectActions | null;
  register: (a: ProjectActions) => void;
  unregister: () => void;
}

export const useProjectActionStore = create<ProjectActionState>()((set) => ({
  actions: null,
  register: (a) => set({ actions: a }),
  unregister: () => set((s) => (s.actions === null ? s : { actions: null })),
}));

export function useProjectActions(): ProjectActions | null {
  return useProjectActionStore((s) => s.actions);
}

/** @deprecated Use {@link useProjectActions} instead. */
export const useProjectContext = useProjectActions;

export function useProjectRegister() {
  const register = useProjectActionStore((s) => s.register);
  const unregister = useProjectActionStore((s) => s.unregister);
  return { register, unregister };
}
