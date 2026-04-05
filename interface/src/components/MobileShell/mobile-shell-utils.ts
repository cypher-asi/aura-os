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
