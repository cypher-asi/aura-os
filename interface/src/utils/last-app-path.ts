/** Base paths for `LAST_APP_KEY` values — kept in sync with app ids in `apps/registry`. */
export const LAST_APP_BASE_PATH: Record<string, string> = {
  agents: "/agents",
  chat: "/chat",
  projects: "/projects",
  tasks: "/tasks",
  process: "/process",
  feed: "/feed",
  profile: "/profile",
  desktop: "/desktop",
};

export const WEB_DEFAULT_APP_PATH = "/chat";
export const DESKTOP_DEFAULT_APP_PATH = "/projects";
export const DEFAULT_APP_PATH = WEB_DEFAULT_APP_PATH;

export function getCapabilityDefaultShellPath(): string {
  if (typeof window === "undefined") return WEB_DEFAULT_APP_PATH;
  const ipc = (window as Window & { ipc?: { postMessage?: unknown } }).ipc;
  return typeof ipc?.postMessage === "function"
    ? DESKTOP_DEFAULT_APP_PATH
    : WEB_DEFAULT_APP_PATH;
}

export function getPathname(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

/**
 * Pure pathname predicate matching the canonical `/chat` route and any
 * descendant subpath (e.g. `/chat/session-123`). Centralised here so
 * callers can share a single rule without a components -> utils
 * import.
 */
export function isChatPathname(pathname: string): boolean {
  return pathname === "/chat" || pathname.startsWith("/chat/");
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

export function getInitialShellPath(
  lastAppId: string | null,
  previousPath?: string | null,
  defaultPath = getCapabilityDefaultShellPath(),
): string {
  const sanitizedPreviousPath = sanitizeRestorePath(previousPath);
  if (sanitizedPreviousPath) {
    return sanitizedPreviousPath;
  }
  const targetPath = lastAppId ? LAST_APP_BASE_PATH[lastAppId] : undefined;
  return targetPath ?? defaultPath;
}
