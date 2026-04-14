export const DEFAULT_SIDEKICK_WIDTH = 320;
export const SIDEKICK_MIN_WIDTH = 200;
export const SIDEKICK_MAX_WIDTH = 1200;
export const SHARED_SIDEKICK_STORAGE_KEY = "aura-sidekick-v2";
export const PROJECTS_SIDEKICK_STORAGE_KEY = "aura-projects-sidekick-v1";
export type SidekickLayoutProfile = "shared" | "projects";

function clampSidekickWidth(width: number) {
  return Math.min(SIDEKICK_MAX_WIDTH, Math.max(SIDEKICK_MIN_WIDTH, width));
}

function getSidekickStorageKey(profile: SidekickLayoutProfile) {
  return profile === "projects"
    ? PROJECTS_SIDEKICK_STORAGE_KEY
    : SHARED_SIDEKICK_STORAGE_KEY;
}

export function getSidekickLayoutProfile(appId: string): SidekickLayoutProfile {
  return appId === "projects" ? "projects" : "shared";
}

export function readStoredSidekickWidth(profile: SidekickLayoutProfile): number {
  if (typeof window === "undefined") return DEFAULT_SIDEKICK_WIDTH;
  try {
    const rawValue = localStorage.getItem(getSidekickStorageKey(profile));
    if (!rawValue) return DEFAULT_SIDEKICK_WIDTH;
    const parsedValue = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsedValue)) return DEFAULT_SIDEKICK_WIDTH;
    return clampSidekickWidth(parsedValue);
  } catch {
    return DEFAULT_SIDEKICK_WIDTH;
  }
}

export function persistSidekickWidth(
  profile: SidekickLayoutProfile,
  width: number,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      getSidekickStorageKey(profile),
      String(clampSidekickWidth(width)),
    );
  } catch {
    // Ignore storage failures.
  }
}

export function getProjectsSidekickTargetWidth(mainWidth: number, sidekickWidth: number) {
  return clampSidekickWidth(Math.round((mainWidth + sidekickWidth) / 2));
}

export function getSidekickTransitionTargetWidth(
  profile: SidekickLayoutProfile,
  mainWidth: number,
  currentSidekickWidth: number,
): number {
  if (profile === "projects") {
    return getProjectsSidekickTargetWidth(mainWidth, currentSidekickWidth);
  }
  return readStoredSidekickWidth("shared");
}
