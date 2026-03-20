import { useContext } from "react";
import { ProjectsListContext } from "./ProjectsListContext.shared";

export function useProjectsList() {
  const context = useContext(ProjectsListContext);
  if (!context) {
    throw new Error("useProjectsList must be used within ProjectsListProvider");
  }
  return context;
}
