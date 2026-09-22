const STORAGE_KEY = "aura:native-route-memory-v1";
const MAX_ROUTE_LENGTH = 2_048;

interface NativeRouteMemoryRecord {
  version: 1;
  userId: string;
  route: string;
}

const RESTORABLE_PATH_PREFIXES = [
  "/agents",
  "/apps",
  "/chat",
  "/debug",
  "/feedback",
  "/marketplace",
  "/observability",
  "/organization",
  "/process",
  "/projects",
  "/settings",
  "/tasks",
] as const;

/**
 * Keep native process restoration inside Aura's authenticated shell. This
 * deliberately excludes login, capture, public marketing, and external URLs.
 */
export function normalizeRestorableNativeRoute(route: string): string | null {
  const value = route.trim();
  if (!value || value.length > MAX_ROUTE_LENGTH || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  try {
    const url = new URL(value, "https://aura.invalid");
    if (url.origin !== "https://aura.invalid") return null;
    const pathAllowed = url.pathname === "/" || RESTORABLE_PATH_PREFIXES.some((prefix) => (
      url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)
    ));
    if (!pathAllowed) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function readNativeRouteMemory(userId: string): string | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Partial<NativeRouteMemoryRecord>;
    if (record.version !== 1 || record.userId !== userId || typeof record.route !== "string") {
      return null;
    }
    return normalizeRestorableNativeRoute(record.route);
  } catch {
    return null;
  }
}

export function writeNativeRouteMemory(userId: string, route: string): void {
  const normalized = normalizeRestorableNativeRoute(route);
  if (!userId || !normalized) return;
  try {
    const record: NativeRouteMemoryRecord = {
      version: 1,
      userId,
      route: normalized,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Route restoration is a convenience; storage pressure must not block boot.
  }
}

/** Restore only the bundled native shell's generic launch route. */
export function resolveNativeInitialRoute(userId: string, currentRoute: string): string | null {
  if (currentRoute !== "/") return null;
  const remembered = readNativeRouteMemory(userId);
  return remembered && remembered !== "/" ? remembered : null;
}
