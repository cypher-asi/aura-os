export const DEFAULT_SIDEKICK_WIDTH = 320;
export const SIDEKICK_MIN_WIDTH = 200;
export const SIDEKICK_MAX_WIDTH = 1200;
export const SHARED_SIDEKICK_STORAGE_KEY = "aura-sidekick-v2";
export const PROJECTS_SIDEKICK_STORAGE_KEY = "aura-projects-sidekick-v1";

function clampSidekickWidth(width: number) {
  return Math.min(SIDEKICK_MAX_WIDTH, Math.max(SIDEKICK_MIN_WIDTH, width));
}

export function getProjectsSidekickTargetWidth(mainWidth: number, sidekickWidth: number) {
  return clampSidekickWidth(Math.round((mainWidth + sidekickWidth) / 2));
}
