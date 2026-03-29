import type { Project } from "../types";

type WorkspaceProject = Pick<Project, "linked_folder_path" | "workspace_source" | "workspace_display_path"> | null | undefined;

export function getProjectWorkspaceRoot(project: WorkspaceProject): string | null {
  const rootPath = project?.linked_folder_path?.trim();
  if (!rootPath) {
    return null;
  }
  return rootPath;
}

export function getLinkedWorkspaceRoot(project: WorkspaceProject): string | null {
  const rootPath = getProjectWorkspaceRoot(project);
  if (!rootPath || project?.workspace_source === "imported") {
    return null;
  }
  return rootPath;
}

export function hasLinkedWorkspace(project: WorkspaceProject): boolean {
  return Boolean(getLinkedWorkspaceRoot(project));
}

export function getProjectWorkspaceLabel(project: WorkspaceProject): string {
  return project?.workspace_source === "imported" ? "Workspace snapshot" : "Linked workspace";
}

export function getProjectWorkspaceDisplay(project: WorkspaceProject): string | null {
  const display = project?.workspace_display_path?.trim();
  if (project?.workspace_source === "imported") {
    if (
      display
      && display.toLowerCase() !== "imported workspace snapshot"
      && display.toLowerCase() !== "imported project files"
    ) {
      return display;
    }
    return null;
  }
  return display || getProjectWorkspaceRoot(project);
}
