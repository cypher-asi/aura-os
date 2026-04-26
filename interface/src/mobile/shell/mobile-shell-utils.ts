import { projectAgentsRoute } from "../../utils/mobileNavigation";

export function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

export function resolveProjectAgentPath(projectId: string) {
  return projectAgentsRoute(projectId);
}

export function resolveWorkspaceReturnPath(projectId: string, state: unknown) {
  if (state && typeof state === "object" && "returnTo" in state) {
    const returnTo = (state as { returnTo?: unknown }).returnTo;
    if (typeof returnTo === "string" && returnTo.startsWith(`/projects/${projectId}/`)) {
      return returnTo;
    }
  }
  return resolveProjectAgentPath(projectId);
}

export function resolveSettingsReturnPath(projectId: string | null | undefined, state: unknown) {
  if (state && typeof state === "object" && "returnTo" in state) {
    const returnTo = (state as { returnTo?: unknown }).returnTo;
    if (typeof returnTo === "string" && returnTo.startsWith("/") && returnTo !== "/projects/settings") {
      return returnTo;
    }
  }
  return projectId ? resolveProjectAgentPath(projectId) : "/projects";
}

export function resolveGlobalReturnPath(projectId: string | null | undefined, state: unknown) {
  if (state && typeof state === "object" && "returnTo" in state) {
    const returnTo = (state as { returnTo?: unknown }).returnTo;
    if (typeof returnTo === "string" && returnTo.startsWith("/")) {
      return returnTo;
    }
  }
  return projectId ? resolveProjectAgentPath(projectId) : "/projects";
}

export function buildMobileReturnState(pathname: string) {
  return { returnTo: pathname };
}
