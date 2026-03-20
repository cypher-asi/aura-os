import type { ReactNode } from "react";
import { SidekickProvider } from "../../context/SidekickContext";
import { ProjectContextProvider } from "../../context/ProjectContext";
import { ProjectsListProvider } from "./ProjectsListContext";

export function ProjectsProvider({ children }: { children: ReactNode }) {
  return (
    <SidekickProvider>
      <ProjectsListProvider>
        <ProjectContextProvider>
          {children}
        </ProjectContextProvider>
      </ProjectsListProvider>
    </SidekickProvider>
  );
}
