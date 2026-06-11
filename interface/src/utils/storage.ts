import {
  AUTHED_SIDEBAR_COLLAPSED_KEY,
  COLLAPSED_PROJECTS_KEY,
  DEBUG_COLLAPSED_PROJECTS_KEY,
  LAST_AGENT_KEY,
  LAST_APP_KEY,
  LAST_DEBUG_PROJECT_KEY,
  LAST_DEBUG_RUN_KEY,
  LAST_PROJECT_KEY,
  MENU_BAR_COLLAPSED_KEY,
  PROJECT_ORDER_KEY,
  PUBLIC_SIDEBAR_COLLAPSED_KEY,
  RECENT_LOGIN_EMAILS_KEY,
  TASKBAR_APP_ORDER_KEY,
  TASKBAR_APPS_COLLAPSED_KEY,
  TASKBAR_HIDDEN_APPS_KEY,
  TASKBAR_RIGHT_COLLAPSED_KEY,
} from "../constants";

type LastAgentMap = Record<string, string>;
const LAST_STANDALONE_AGENT_KEY = "aura:lastAgentId";
const LAST_PROCESS_ID_KEY = "aura:lastProcessId";
const LAST_NOTE_KEY = "aura:lastNote";

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

export function getLastStandaloneAgentId(): string | null {
  try {
    return localStorage.getItem(LAST_STANDALONE_AGENT_KEY);
  } catch {
    return null;
  }
}

export function setLastStandaloneAgentId(agentId: string): void {
  try {
    localStorage.setItem(LAST_STANDALONE_AGENT_KEY, agentId);
  } catch {
    // ignore storage failures
  }
}

export function clearLastStandaloneAgentId(): void {
  try {
    localStorage.removeItem(LAST_STANDALONE_AGENT_KEY);
  } catch {
    // ignore storage failures
  }
}

export function getLastProcessId(): string | null {
  try {
    return localStorage.getItem(LAST_PROCESS_ID_KEY);
  } catch {
    return null;
  }
}

export function setLastProcessId(processId: string): void {
  try {
    localStorage.setItem(LAST_PROCESS_ID_KEY, processId);
  } catch {
    // ignore storage failures
  }
}

export function clearLastProcessId(): void {
  try {
    localStorage.removeItem(LAST_PROCESS_ID_KEY);
  } catch {
    // ignore storage failures
  }
}

export interface LastNoteRef {
  projectId: string;
  noteId: string;
}

export function getLastNote(): LastNoteRef | null {
  try {
    const raw = localStorage.getItem(LAST_NOTE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.projectId === "string" &&
      typeof parsed.noteId === "string" &&
      parsed.projectId &&
      parsed.noteId
    ) {
      return { projectId: parsed.projectId, noteId: parsed.noteId };
    }
  } catch {
    // ignore malformed data
  }
  return null;
}

export function setLastNote(ref: LastNoteRef): void {
  try {
    localStorage.setItem(LAST_NOTE_KEY, JSON.stringify(ref));
  } catch {
    // ignore storage failures
  }
}

export function clearLastNote(): void {
  try {
    localStorage.removeItem(LAST_NOTE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function getCollapsedDebugProjects(): string[] {
  try {
    const raw = localStorage.getItem(DEBUG_COLLAPSED_PROJECTS_KEY);
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

export function setCollapsedDebugProjects(ids: string[]): void {
  try {
    if (ids.length === 0) {
      localStorage.removeItem(DEBUG_COLLAPSED_PROJECTS_KEY);
      return;
    }
    localStorage.setItem(DEBUG_COLLAPSED_PROJECTS_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage failures
  }
}

export function getLastDebugProject(): string | null {
  try {
    return localStorage.getItem(LAST_DEBUG_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setLastDebugProject(projectId: string): void {
  try {
    localStorage.setItem(LAST_DEBUG_PROJECT_KEY, projectId);
  } catch {
    // ignore storage failures
  }
}

export function clearLastDebugProject(): void {
  try {
    localStorage.removeItem(LAST_DEBUG_PROJECT_KEY);
  } catch {
    // ignore storage failures
  }
}

type LastDebugRunMap = Record<string, string>;

function getLastDebugRunMap(): LastDebugRunMap {
  try {
    const raw = localStorage.getItem(LAST_DEBUG_RUN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as LastDebugRunMap;
    }
  } catch {
    // ignore malformed data
  }
  return {};
}

function writeLastDebugRunMap(map: LastDebugRunMap): void {
  try {
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(LAST_DEBUG_RUN_KEY);
      return;
    }
    localStorage.setItem(LAST_DEBUG_RUN_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures
  }
}

export function getLastDebugRun(projectId: string): string | null {
  return getLastDebugRunMap()[projectId] ?? null;
}

export function setLastDebugRun(projectId: string, runId: string): void {
  const map = getLastDebugRunMap();
  map[projectId] = runId;
  writeLastDebugRunMap(map);
}

export function clearLastDebugRunIf(match: {
  projectId?: string;
  runId?: string;
}): void {
  const map = getLastDebugRunMap();
  let changed = false;

  if (match.projectId && map[match.projectId] !== undefined) {
    if (!match.runId || map[match.projectId] === match.runId) {
      delete map[match.projectId];
      changed = true;
    }
  } else if (match.runId) {
    for (const [pid, rid] of Object.entries(map)) {
      if (rid === match.runId) {
        delete map[pid];
        changed = true;
      }
    }
  }

  if (changed) writeLastDebugRunMap(map);
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

function getProjectOrderStorageKey(orgId: string | null | undefined): string {
  return `${PROJECT_ORDER_KEY}:${orgId ?? "all"}`;
}

export function getProjectOrder(orgId: string | null | undefined): string[] {
  try {
    const raw = localStorage.getItem(getProjectOrderStorageKey(orgId));
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

export function setProjectOrder(orgId: string | null | undefined, ids: string[]): void {
  try {
    const storageKey = getProjectOrderStorageKey(orgId);
    if (ids.length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(ids));
  } catch {
    // ignore storage failures
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

export function getTaskbarRightCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(TASKBAR_RIGHT_COLLAPSED_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // ignore storage failures
  }
  return true;
}

export function setTaskbarRightCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(TASKBAR_RIGHT_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore storage failures
  }
}

/**
 * Public-shell sidebar collapse state. Defaults to `true` (collapsed)
 * on first visit so logged-out visitors land on a clean ChatGPT-style
 * surface; subsequent toggles via the titlebar's left drawer button
 * persist here so the choice survives reloads.
 */
export function getPublicSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(PUBLIC_SIDEBAR_COLLAPSED_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // ignore storage failures
  }
  return true;
}

export function setPublicSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PUBLIC_SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore storage failures
  }
}

/**
 * Authenticated standard-shell sidebar collapse state.
 * Defaults to `false` (open) so signed-in users continue to land on
 * the familiar always-open sidebar; the titlebar drawer toggle
 * (`<PanelLeft />`) writes the user's choice here so it survives
 * reloads. Persisted under a separate key from `PUBLIC_SIDEBAR_
 * COLLAPSED_KEY` so the public and authed drawers remember their
 * own positions independently.
 */
export function getAuthedSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(AUTHED_SIDEBAR_COLLAPSED_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // ignore storage failures
  }
  return false;
}

export function setAuthedSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(AUTHED_SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // ignore storage failures
  }
}

/**
 * Application menu bar (File / Edit / View / Help) collapse state.
 * Defaults to `false` (expanded) so the menu bar shows by default;
 * the titlebar chevron toggle writes the user's choice here so it
 * survives reloads, mirroring the bottom-taskbar collapse sections.
 */
export function getMenuBarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(MENU_BAR_COLLAPSED_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // ignore storage failures
  }
  return false;
}

export function setMenuBarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(MENU_BAR_COLLAPSED_KEY, String(collapsed));
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

/**
 * Returns the user's saved hidden-apps list, or `null` when no entry exists in
 * storage. The `null` sentinel lets callers (the app store) fall back to
 * registry-derived defaults on first load while still respecting an explicit
 * empty array (i.e. the user un-hid everything).
 */
export function getTaskbarHiddenAppIds(): string[] | null {
  try {
    const raw = localStorage.getItem(TASKBAR_HIDDEN_APPS_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    // ignore malformed data
  }
  return [];
}

export function setTaskbarHiddenAppIds(ids: string[]): void {
  try {
    // Always persist, even when empty, so a user who explicitly clears all
    // hidden apps isn't re-defaulted back to the registry's `defaultHidden`
    // set on the next load.
    localStorage.setItem(TASKBAR_HIDDEN_APPS_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage failures
  }
}

const MAX_RECENT_LOGIN_EMAILS = 5;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Previously-used login emails, most-recent first. Lets the login form
 * offer a dropdown of remembered accounts instead of forcing the user
 * to retype their address on every visit. Capped at
 * `MAX_RECENT_LOGIN_EMAILS`; passwords are never stored.
 */
export function getRecentLoginEmails(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_LOGIN_EMAILS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
    }
  } catch {
    // ignore malformed data
  }
  return [];
}

export function addRecentLoginEmail(email: string): void {
  const trimmed = email.trim();
  if (!trimmed) return;
  try {
    const key = normalizeEmail(trimmed);
    const next = [
      trimmed,
      ...getRecentLoginEmails().filter((e) => normalizeEmail(e) !== key),
    ].slice(0, MAX_RECENT_LOGIN_EMAILS);
    localStorage.setItem(RECENT_LOGIN_EMAILS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
}

export function removeRecentLoginEmail(email: string): void {
  try {
    const key = normalizeEmail(email);
    const next = getRecentLoginEmails().filter((e) => normalizeEmail(e) !== key);
    if (next.length === 0) {
      localStorage.removeItem(RECENT_LOGIN_EMAILS_KEY);
      return;
    }
    localStorage.setItem(RECENT_LOGIN_EMAILS_KEY, JSON.stringify(next));
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
