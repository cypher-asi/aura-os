import type { Project } from "../types";

type WorkspaceProject = Pick<Project, "linked_folder_path" | "workspace_source"> | null | undefined;

export function getLinkedWorkspaceRoot(project: WorkspaceProject): string | null {
  const rootPath = project?.linked_folder_path?.trim();
  if (!rootPath || project?.workspace_source === "imported") {
    return null;
  }
  return rootPath;
}

export function hasLinkedWorkspace(project: WorkspaceProject): boolean {
  return Boolean(getLinkedWorkspaceRoot(project));
}
