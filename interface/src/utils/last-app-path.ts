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

function getPathname(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

export function isValidRestorePath(path: string | null): path is string {
  if (!path) return false;
  const pathname = getPathname(path);
  return (
    pathname !== "/" &&
    pathname !== "/login" &&
    pathname !== "/health" &&
    pathname !== "/api" &&
    pathname !== "/ws" &&
    !pathname.startsWith("/api/") &&
    !pathname.startsWith("/ws/") &&
    !pathname.startsWith("/desktop")
  );
}

export function sanitizeRestorePath(path: string | null | undefined): string | null {
  if (!isValidRestorePath(path ?? null)) {
    return null;
  }

  const [withoutHash, hash = ""] = (path ?? "").split("#", 2);
  const [pathname, query = ""] = withoutHash.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("host");
  const search = params.toString();

  return `${pathname}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

export function getInitialShellPath(lastAppId: string | null, previousPath?: string | null): string {
  const sanitizedPreviousPath = sanitizeRestorePath(previousPath);
  if (sanitizedPreviousPath) {
    return sanitizedPreviousPath;
  }
  const targetPath = lastAppId ? LAST_APP_BASE_PATH[lastAppId] : undefined;
  return targetPath ?? DEFAULT_APP_PATH;
}
