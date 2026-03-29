import { LAST_AGENT_KEY, LAST_APP_KEY, LAST_PROJECT_KEY } from "../constants";

type LastAgentMap = Record<string, string>;

function getMap(): LastAgentMap {
  try {
    const raw = localStorage.getItem(LAST_AGENT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore malformed data
  }
  return {};
}

export function getLastAgent(projectId: string): string | null {
  return getMap()[projectId] ?? null;
}

export function getLastAgentEntry(): { projectId: string; agentInstanceId: string } | null {
  const entries = Object.entries(getMap());
  if (entries.length === 0) return null;
  const [projectId, agentInstanceId] = entries[entries.length - 1];
  return { projectId, agentInstanceId };
}

export function setLastAgent(projectId: string, agentInstanceId: string): void {
  const map = getMap();
  map[projectId] = agentInstanceId;
  localStorage.setItem(LAST_AGENT_KEY, JSON.stringify(map));
}

export function getLastApp(): string | null {
  return localStorage.getItem(LAST_APP_KEY);
}

export function setLastApp(appId: string): void {
  localStorage.setItem(LAST_APP_KEY, appId);
}

export function getLastProject(): string | null {
  return localStorage.getItem(LAST_PROJECT_KEY);
}

export function setLastProject(projectId: string): void {
  localStorage.setItem(LAST_PROJECT_KEY, projectId);
}

export function clearLastAgentIf(match: { projectId?: string; agentInstanceId?: string }): void {
  try {
    const map = getMap();
    let changed = false;

    if (match.projectId && map[match.projectId]) {
      delete map[match.projectId];
      changed = true;
    }

    if (match.agentInstanceId) {
      for (const [pid, aid] of Object.entries(map)) {
        if (aid === match.agentInstanceId) {
          delete map[pid];
          changed = true;
        }
      }
    }

    if (changed) {
      if (Object.keys(map).length === 0) {
        localStorage.removeItem(LAST_AGENT_KEY);
      } else {
        localStorage.setItem(LAST_AGENT_KEY, JSON.stringify(map));
      }
    }
  } catch {
    // ignore
  }
}
