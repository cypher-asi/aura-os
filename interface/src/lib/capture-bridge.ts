import { apps } from "../apps/registry";
import { LAST_APP_KEY, PREVIOUS_PATH_KEY } from "../constants";
import { sanitizeRestorePath } from "../utils/last-app-path";

const DESKTOP_WINDOWS_STORAGE_KEY = "aura:desktopWindows";

const appBasePathById = new Map(apps.map((app) => [app.id, app.basePath]));

export interface AuraCaptureResetRequest {
  targetAppId?: string | null;
  targetPath?: string | null;
  sidekickCollapsed?: boolean;
  timeoutMs?: number;
}

export interface AuraCaptureBridgeState {
  timestamp: string;
  currentPath: string;
  targetPath: string | null;
  targetAppId: string | null;
  routeMatched: boolean;
  activeAppId: string | null;
  activeAppLabel: string | null;
  activeAppMatched: boolean;
  launcherVisible: boolean;
  mainPanelVisible: boolean;
  shellVisible: boolean;
  sidekickVisible: boolean;
  placeholderVisible: boolean;
  feedbackComposerVisible: boolean;
  dialogVisible: boolean;
  sidekickInfoVisible: boolean;
  sidekickPreviewVisible: boolean;
  orgSettingsOpen: boolean;
  buyCreditsOpen: boolean;
  hostSettingsOpen: boolean;
  appsModalOpen: boolean;
  newProjectModalOpen: boolean;
  desktopWindowCount: number;
}

function normalizePathname(value: string | null | undefined): string | null {
  const sanitized = sanitizeRestorePath(value);
  if (!sanitized) {
    return null;
  }
  return sanitized.split(/[?#]/, 1)[0] ?? sanitized;
}

function matchesTargetPath(currentPath: string, targetPath: string | null): boolean {
  const expectedPathname = normalizePathname(targetPath);
  if (!expectedPathname) {
    return true;
  }

  const currentPathname = normalizePathname(currentPath);
  if (!currentPathname) {
    return false;
  }

  return currentPathname === expectedPathname
    || currentPathname.startsWith(`${expectedPathname}/`);
}

function isVisible(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && Number(style.opacity || 1) > 0.05
    && rect.width > 0
    && rect.height > 0;
}

function hasVisibleDialogWithText(pattern: RegExp): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
    .some((node) => isVisible(node) && pattern.test(node.textContent || ""));
}

export function resolveAuraCaptureTargetAppId(request: AuraCaptureResetRequest = {}): string | null {
  if (request.targetAppId && appBasePathById.has(request.targetAppId)) {
    return request.targetAppId;
  }

  const targetPathname = normalizePathname(request.targetPath);
  if (!targetPathname) {
    return null;
  }

  const matched = apps.find((app) =>
    targetPathname === app.basePath || targetPathname.startsWith(`${app.basePath}/`),
  );
  return matched?.id ?? null;
}

export function resolveAuraCaptureTargetPath(request: AuraCaptureResetRequest = {}): string | null {
  const explicitPath = sanitizeRestorePath(request.targetPath);
  if (explicitPath) {
    return explicitPath;
  }

  const targetAppId = resolveAuraCaptureTargetAppId(request);
  if (!targetAppId) {
    return null;
  }

  return appBasePathById.get(targetAppId) ?? null;
}

export function persistAuraCaptureTarget(targetPath: string | null, targetAppId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (targetPath) {
      window.localStorage.setItem(PREVIOUS_PATH_KEY, targetPath);
    } else {
      window.localStorage.removeItem(PREVIOUS_PATH_KEY);
    }

    if (targetAppId) {
      window.localStorage.setItem(LAST_APP_KEY, targetAppId);
    } else {
      window.localStorage.removeItem(LAST_APP_KEY);
    }
  } catch {
    // Ignore storage failures inside the screenshot bridge.
  }
}

export function clearAuraDesktopWindowPersistence(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(DESKTOP_WINDOWS_STORAGE_KEY);
  } catch {
    // Ignore storage failures inside the screenshot bridge.
  }
}

export function readAuraCaptureBridgeState(
  request: AuraCaptureResetRequest = {},
): AuraCaptureBridgeState {
  const targetPath = resolveAuraCaptureTargetPath(request);
  const targetAppId = resolveAuraCaptureTargetAppId({
    ...request,
    targetPath,
  });
  const currentPath =
    typeof window === "undefined"
      ? ""
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const mainPanel = document.querySelector('[data-agent-surface="main-panel"]');
  const activeAppId = mainPanel?.getAttribute("data-agent-active-app-id") || null;
  const activeAppLabel = mainPanel?.getAttribute("data-agent-active-app-label") || null;
  const launcherVisible = Array.from(document.querySelectorAll('[data-agent-role="app-launcher"]'))
    .some((node) => isVisible(node));
  const mainPanelVisible = isVisible(mainPanel);
  const sidekickVisible = isVisible(document.querySelector('[data-agent-surface="sidekick-panel"]'));
  const placeholderVisible = isVisible(document.querySelector('[data-agent-surface="shell-route-placeholder"]'));
  const feedbackComposerVisible = isVisible(document.querySelector('[data-agent-surface="feedback-composer"]'));
  const dialogVisible = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
    .some((node) => isVisible(node));

  return {
    timestamp: new Date().toISOString(),
    currentPath,
    targetPath,
    targetAppId,
    routeMatched: matchesTargetPath(currentPath, targetPath),
    activeAppId,
    activeAppLabel,
    activeAppMatched: targetAppId ? activeAppId === targetAppId : true,
    launcherVisible,
    mainPanelVisible,
    shellVisible: launcherVisible || mainPanelVisible,
    sidekickVisible,
    placeholderVisible,
    feedbackComposerVisible,
    dialogVisible,
    sidekickInfoVisible: Boolean(document.querySelector('[data-sidekick-info="true"]')),
    sidekickPreviewVisible: Boolean(document.querySelector('[data-sidekick-preview="true"]')),
    orgSettingsOpen: hasVisibleDialogWithText(/\bteam settings\b/i),
    buyCreditsOpen: hasVisibleDialogWithText(/\bbuy credits\b/i),
    hostSettingsOpen: hasVisibleDialogWithText(/\bhost connection\b/i),
    appsModalOpen: hasVisibleDialogWithText(/\bvisible in taskbar\b/i),
    newProjectModalOpen: hasVisibleDialogWithText(/\bnew project\b/i),
    desktopWindowCount: document.querySelectorAll('[data-window-layer-host="true"] [data-agent-id]').length,
  };
}
