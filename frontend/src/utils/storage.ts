import { LAST_AGENT_KEY } from "../constants";

export function getLastAgent(): { projectId: string; agentInstanceId: string } | null {
  try {
    const raw = localStorage.getItem(LAST_AGENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.projectId && parsed?.agentInstanceId) return parsed;
  } catch {
    // ignore malformed data
  }
  return null;
}

export function setLastAgent(projectId: string, agentInstanceId: string): void {
  localStorage.setItem(LAST_AGENT_KEY, JSON.stringify({ projectId, agentInstanceId }));
}

export function clearLastAgentIf(match: { projectId?: string; agentInstanceId?: string }): void {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_AGENT_KEY) || "{}");
    if (
      (match.projectId && last.projectId === match.projectId) ||
      (match.agentInstanceId && last.agentInstanceId === match.agentInstanceId)
    ) {
      localStorage.removeItem(LAST_AGENT_KEY);
    }
  } catch {
    // ignore
  }
}
