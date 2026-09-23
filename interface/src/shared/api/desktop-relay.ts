import { authHeaders } from "../lib/auth-token";
import { resolveApiUrl } from "../lib/host-config";
import { useSyncExternalStore } from "react";

/** The active paired desktop is a routing hint, never a credential. */
export const DESKTOP_RELAY_ENVIRONMENT_KEY = "aura:desktopRelayEnvironmentId";

export interface DesktopEnvironment {
  environment_id: string;
  label: string;
  connected: boolean;
  last_seen_at: string;
}

export type DesktopRelayStatus = "idle" | "loading" | "ready" | "error";

export interface DesktopRelaySnapshot {
  status: DesktopRelayStatus;
  environments: DesktopEnvironment[];
  activeEnvironment: DesktopEnvironment | null;
}

const EMPTY_SNAPSHOT: DesktopRelaySnapshot = {
  status: "idle",
  environments: [],
  activeEnvironment: null,
};

let snapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();

function publish(next: DesktopRelaySnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

/** Reactive view of the paired-desktop state used by mobile surfaces. */
export function useDesktopRelayStatus(): DesktopRelaySnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);
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
  publish({ ...snapshot, status: "loading" });
  try {
    const response = await Promise.resolve(fetch(resolveApiUrl("/api/desktop/environments"), {
      credentials: "include",
      headers: { ...authHeaders(), Accept: "application/json" },
    }));
    if (!response || !response.ok) {
      publish({ ...snapshot, status: "error" });
      return [];
    }
    const environments = (await response.json()) as unknown;
    if (!Array.isArray(environments)) {
      publish({ ...snapshot, status: "error" });
      return [];
    }
    const valid = environments.filter((entry): entry is DesktopEnvironment => {
      if (entry == null || typeof entry !== "object") return false;
      const value = entry as Partial<DesktopEnvironment>;
      return (
        typeof value.environment_id === "string" &&
        value.environment_id.length > 0 &&
        typeof value.label === "string" &&
        typeof value.connected === "boolean" &&
        typeof value.last_seen_at === "string"
      );
    });
    let activeEnvironment: DesktopEnvironment | null = null;
    if (typeof window !== "undefined") {
      const current = activeDesktopEnvironmentId();
      const next = valid.find((entry) => entry.environment_id === current) ?? valid[0];
      if (next) window.localStorage.setItem(DESKTOP_RELAY_ENVIRONMENT_KEY, next.environment_id);
      else if (current) window.localStorage.removeItem(DESKTOP_RELAY_ENVIRONMENT_KEY);
      activeEnvironment = next ?? null;
    }
    publish({ status: "ready", environments: valid, activeEnvironment });
    return valid;
  } catch {
    publish({ ...snapshot, status: "error" });
    return [];
  }
}
