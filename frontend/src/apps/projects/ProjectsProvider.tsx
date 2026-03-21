import type { ReactNode } from "react";
import { ProjectContextProvider } from "../../context/ProjectContext";
import { ProjectsListProvider } from "./ProjectsListContext";

export function ProjectsProvider({ children }: { children: ReactNode }) {
  return (
    <ProjectsListProvider>
      <ProjectContextProvider>
        {children}
      </ProjectContextProvider>
    </ProjectsListProvider>
  );
}
