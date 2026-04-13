import {
  COLLAPSED_PROJECTS_KEY,
  LAST_AGENT_KEY,
  LAST_APP_KEY,
  LAST_PROJECT_KEY,
  TASKBAR_APP_ORDER_KEY,
  TASKBAR_APPS_COLLAPSED_KEY,
} from "../constants";

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

export function getCollapsedProjects(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore malformed data
  }
  return [];
}

export function setCollapsedProjects(ids: string[]): void {
  if (ids.length === 0) {
    localStorage.removeItem(COLLAPSED_PROJECTS_KEY);
  } else {
    localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify(ids));
  }
}

export function getTaskbarAppsCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(TASKBAR_APPS_COLLAPSED_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // ignore storage failures
  }
  return true;
}

export function setTaskbarAppsCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(TASKBAR_APPS_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore storage failures
  }
}

export function getTaskbarAppOrder(): string[] {
  try {
    const raw = localStorage.getItem(TASKBAR_APP_ORDER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    // ignore malformed data
  }
  return [];
}

export function setTaskbarAppOrder(ids: string[]): void {
  try {
    if (ids.length === 0) {
      localStorage.removeItem(TASKBAR_APP_ORDER_KEY);
      return;
    }
    localStorage.setItem(TASKBAR_APP_ORDER_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage failures
  }
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
