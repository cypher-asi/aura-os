export type MobileProjectDestination = "agent" | "execution" | "tasks" | "files" | "stats" | "process" | "skills" | "feed" | null;
export type MobileShellMode = "global" | "project";
const RESERVED_PROJECT_PATHS = new Set(["organization", "settings"]);

function matchProjectPath(pathname: string) {
  return pathname.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
}

export function getProjectIdFromPathname(pathname: string): string | null {
  const match = matchProjectPath(pathname);
  const projectId = match?.[1] ?? null;
  if (projectId && RESERVED_PROJECT_PATHS.has(projectId)) {
    return null;
  }
  return projectId;
}

export function getProjectAgentInstanceIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/[^/]+\/agents\/([^/]+)/);
  return match?.[1] ?? null;
}

export function getMobileProjectDestination(pathname: string): MobileProjectDestination {
  if (pathname === "/feed" || pathname.startsWith("/feed/")) {
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
    return "execution";
  }
  if (suffix === "tasks") {
    return "tasks";
  }
  if (suffix === "files") {
    return "files";
  }
  if (suffix === "process") {
    return "process";
  }
  if (suffix === "stats") {
    return "stats";
  }
  if (suffix === "agents/create") {
    return null;
  }
  if (suffix === "agents/attach") {
    return null;
  }
  if (/^agents\/[^/]+\/details$/.test(suffix)) {
    return "agent";
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
    || pathname.startsWith("/projects/organization")
    || pathname === "/feed"
    || pathname.startsWith("/feed/")
    || pathname === "/feedback"
    || pathname.startsWith("/feedback/")
    || pathname === "/profile"
    || pathname.startsWith("/profile/")
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

export function projectAgentCreateRoute(projectId: string): string {
  return `/projects/${projectId}/agents/create`;
}

export function projectAgentAttachRoute(projectId: string): string {
  return `/projects/${projectId}/agents/attach`;
}

export function projectWorkRoute(projectId: string): string {
  return `/projects/${projectId}/work`;
}

export function projectTasksRoute(projectId: string): string {
  return `/projects/${projectId}/tasks`;
}

export function projectFilesRoute(projectId: string): string {
  return `/projects/${projectId}/files`;
}

export function projectProcessRoute(projectId: string): string {
  return `/projects/${projectId}/process`;
}

export function projectStatsRoute(projectId: string): string {
  return `/projects/${projectId}/stats`;
}

export function projectAgentDetailsRoute(projectId: string, agentInstanceId: string): string {
  return `/projects/${projectId}/agents/${agentInstanceId}/details`;
}

export function isProjectSubroute(pathname: string, projectId: string | null): boolean {
  if (!projectId) return false;
  return pathname.startsWith(`/projects/${projectId}/`);
}
