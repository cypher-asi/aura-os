import { authHeaders } from "../lib/auth-token";
import { resolveApiUrl } from "../lib/host-config";

/** The active paired desktop is a routing hint, never a credential. */
export const DESKTOP_RELAY_ENVIRONMENT_KEY = "aura:desktopRelayEnvironmentId";

export interface DesktopEnvironment {
  environment_id: string;
  label: string;
  connected: boolean;
  last_seen_at: string;
}

export function activeDesktopEnvironmentId(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(DESKTOP_RELAY_ENVIRONMENT_KEY)?.trim();
  return value || null;
}

/**
 * Refresh the paired-desktop hint. A missing/old server simply yields an
 * empty list, so this is safe during rolling deploys and on desktop loopback.
 */
export async function refreshDesktopRelayEnvironment(): Promise<DesktopEnvironment[]> {
  try {
    const response = await Promise.resolve(fetch(resolveApiUrl("/api/desktop/environments"), {
      credentials: "include",
      headers: { ...authHeaders(), Accept: "application/json" },
    }));
    if (!response || !response.ok) return [];
    const environments = (await response.json()) as unknown;
    if (!Array.isArray(environments)) return [];
    const valid = environments.filter((entry): entry is DesktopEnvironment => {
      if (entry == null || typeof entry !== "object") return false;
      const value = entry as Partial<DesktopEnvironment>;
      return typeof value.environment_id === "string" && value.environment_id.length > 0;
    });
    if (typeof window !== "undefined") {
      const current = activeDesktopEnvironmentId();
      const next = valid.find((entry) => entry.environment_id === current) ?? valid[0];
      if (next) window.localStorage.setItem(DESKTOP_RELAY_ENVIRONMENT_KEY, next.environment_id);
      else if (current) window.localStorage.removeItem(DESKTOP_RELAY_ENVIRONMENT_KEY);
    }
    return valid;
  } catch {
    return [];
  }
}
