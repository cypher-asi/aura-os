export type MobileProjectDestination = "agent" | "tasks" | "files" | "feed" | null;
export type MobileShellMode = "global" | "project";

function matchProjectPath(pathname: string) {
  return pathname.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
}

export function getProjectIdFromPathname(pathname: string): string | null {
  const match = matchProjectPath(pathname);
  return match?.[1] ?? null;
}

export function getMobileProjectDestination(pathname: string): MobileProjectDestination {
  if (pathname.startsWith("/feed")) {
    return "feed";
  }

  const match = matchProjectPath(pathname);
  if (!match) {
    return null;
  }

  const suffix = match[2] ?? "";
  if (suffix === "" || suffix === undefined) {
    return null;
  }
  if (suffix === "work" || suffix === "execution") {
    return "tasks";
  }
  if (suffix === "files") {
    return "files";
  }
  if (suffix === "agent" || suffix.startsWith("agents/")) {
    return "agent";
  }

  return null;
}

export function getMobileShellMode(
  pathname: string,
  currentProjectId: string | null,
  hasResolvedCurrentProject: boolean,
): MobileShellMode {
  if (
    pathname === "/projects"
    || pathname.startsWith("/feed")
    || pathname.startsWith("/profile")
    || pathname.startsWith("/leaderboard")
  ) {
    return "global";
  }

  if (currentProjectId && hasResolvedCurrentProject) {
    return "project";
  }

  return "global";
}

export function projectRootPath(projectId: string): string {
  return `/projects/${projectId}`;
}

export function projectAgentRoute(projectId: string): string {
  return `/projects/${projectId}/agent`;
}

export function projectAgentChatRoute(projectId: string, agentInstanceId: string): string {
  return `/projects/${projectId}/agents/${agentInstanceId}`;
}

export function projectWorkRoute(projectId: string): string {
  return `/projects/${projectId}/work`;
}

export function projectFilesRoute(projectId: string): string {
  return `/projects/${projectId}/files`;
}

export function isProjectSubroute(pathname: string, projectId: string | null): boolean {
  if (!projectId) return false;
  return pathname.startsWith(`/projects/${projectId}/`);
}
