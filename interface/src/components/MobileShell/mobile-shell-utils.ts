import { getLastAgent } from "../../utils/storage";
import { projectAgentChatRoute, projectAgentRoute } from "../../utils/mobileNavigation";

export function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

export function resolveProjectAgentPath(projectId: string) {
  const lastAgentInstanceId = getLastAgent(projectId);
  if (lastAgentInstanceId) {
    return projectAgentChatRoute(projectId, lastAgentInstanceId);
  }
  return projectAgentRoute(projectId);
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
