/** Base paths for `LAST_APP_KEY` values — kept in sync with app ids in `apps/registry`. */
export const LAST_APP_BASE_PATH: Record<string, string> = {
  agents: "/agents",
  projects: "/projects",
  tasks: "/tasks",
  process: "/process",
  feed: "/feed",
  profile: "/profile",
  desktop: "/desktop",
};

export const DEFAULT_APP_PATH = "/agents";

export function getInitialShellPath(
  lastAppId: string | null,
  supportsDesktopWorkspace: boolean,
): string {
  if (supportsDesktopWorkspace) return "/desktop";
  const targetPath = lastAppId ? LAST_APP_BASE_PATH[lastAppId] : undefined;
  return targetPath ?? DEFAULT_APP_PATH;
}
