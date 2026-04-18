export const DEFAULT_SIDEKICK_WIDTH = 320;
export const SIDEKICK_MIN_WIDTH = 200;
export const SIDEKICK_MAX_WIDTH = 1200;

/**
 * Per-app storage key prefix. Each app (tasks, agents, projects, notes, ...)
 * persists its own sidekick width so switching apps restores the size the user
 * chose for the target app.
 */
export const PER_APP_SIDEKICK_STORAGE_PREFIX = "aura-sidekick-width:";

// Legacy keys kept for one-time read-through migration to the per-app scheme.
export const LEGACY_SHARED_SIDEKICK_STORAGE_KEY = "aura-sidekick-v2";
export const LEGACY_PROJECTS_SIDEKICK_STORAGE_KEY = "aura-projects-sidekick-v1";

function clampSidekickWidth(width: number) {
  return Math.min(SIDEKICK_MAX_WIDTH, Math.max(SIDEKICK_MIN_WIDTH, width));
}

function getSidekickStorageKey(appId: string) {
  return `${PER_APP_SIDEKICK_STORAGE_PREFIX}${appId}`;
}

function getLegacyStorageKey(appId: string): string {
  return appId === "projects"
    ? LEGACY_PROJECTS_SIDEKICK_STORAGE_KEY
    : LEGACY_SHARED_SIDEKICK_STORAGE_KEY;
}

function parseStoredWidth(rawValue: string | null): number | null {
  if (rawValue == null) return null;
  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue)) return null;
  return clampSidekickWidth(parsedValue);
}

/**
 * Read the stored sidekick width for an app. If no per-app value exists,
 * falls back to the legacy key (shared-v2 / projects-v1) so existing users
 * don't lose their preference on first load after the upgrade.
 *
 * Returns DEFAULT_SIDEKICK_WIDTH when nothing is stored.
 */
export function readStoredSidekickWidth(appId: string): number {
  if (typeof window === "undefined") return DEFAULT_SIDEKICK_WIDTH;
  try {
    const perAppValue = parseStoredWidth(
      localStorage.getItem(getSidekickStorageKey(appId)),
    );
    if (perAppValue != null) return perAppValue;

    const legacyValue = parseStoredWidth(
      localStorage.getItem(getLegacyStorageKey(appId)),
    );
    if (legacyValue != null) return legacyValue;

    return DEFAULT_SIDEKICK_WIDTH;
  } catch {
    return DEFAULT_SIDEKICK_WIDTH;
  }
}

export function persistSidekickWidth(appId: string, width: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      getSidekickStorageKey(appId),
      String(clampSidekickWidth(width)),
    );
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Returns true when no per-app width has been stored for `appId` (ignoring the
 * legacy fallback). Used to decide when the Projects app should fall back to
 * the balanced-width default the first time it's entered.
 */
export function hasStoredSidekickWidth(appId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(getSidekickStorageKey(appId)) != null;
  } catch {
    return false;
  }
}

export function getProjectsSidekickTargetWidth(
  mainWidth: number,
  sidekickWidth: number,
) {
  return clampSidekickWidth(Math.round((mainWidth + sidekickWidth) / 2));
}

/**
 * Width the sidekick Lane should be resized to when `appId` becomes the
 * active app.
 *
 * - Projects: when no per-app width has been persisted yet, use a balanced
 *   average of the current main-panel width and current sidekick width. This
 *   preserves the historical "projects enters with a wide sidekick" behavior
 *   for first-time users. Once the user drags, the persisted value wins.
 * - Everything else: the stored per-app width (or the legacy fallback, or the
 *   default).
 */
export function getSidekickTargetWidth(
  appId: string,
  context: { mainWidth: number; currentSidekickWidth: number },
): number {
  if (appId === "projects" && !hasStoredSidekickWidth("projects")) {
    return getProjectsSidekickTargetWidth(
      context.mainWidth,
      context.currentSidekickWidth,
    );
  }
  return readStoredSidekickWidth(appId);
}
