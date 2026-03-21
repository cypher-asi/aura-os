import { create } from "zustand";
import {
  getConfiguredHostOrigin,
  resolveApiUrl,
  setConfiguredHostOrigin,
  subscribeToHostChanges,
} from "../lib/host-config";

export type HostConnectionStatus = "checking" | "online" | "auth_required" | "unreachable" | "error";

const PROBE_INTERVAL_MS = 20_000;
const PROBE_TIMEOUT_MS = 4_000;

async function probeHost(): Promise<HostConnectionStatus> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(resolveApiUrl("/api/auth/session"), {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    });

    if (response.status === 401) return "auth_required";
    if (response.status === 502 || response.status === 503 || response.status === 504) return "unreachable";
    if (response.ok || response.status < 500) return "online";
    return "error";
  } catch {
    return "unreachable";
  } finally {
    window.clearTimeout(timer);
  }
}

interface HostState {
  hostOrigin: string | null;
  status: HostConnectionStatus;
  lastCheckedAt: number | null;
  setHostOrigin: (value: string | null) => string | null;
  refreshStatus: () => Promise<void>;
}

let probeInFlight = false;

export const useHostStore = create<HostState>()((set) => ({
  hostOrigin: getConfiguredHostOrigin(),
  status: "checking",
  lastCheckedAt: null,

  setHostOrigin: (value: string | null) => {
    const next = setConfiguredHostOrigin(value);
    set({ hostOrigin: next });
    return next;
  },

  refreshStatus: async () => {
    if (probeInFlight) return;
    probeInFlight = true;
    set((prev) => ({ status: prev.status === "checking" ? prev.status : "checking" }));
    try {
      const next = await probeHost();
      set({ status: next, lastCheckedAt: Date.now() });
    } finally {
      probeInFlight = false;
    }
  },
}));

// Sync hostOrigin when changed externally (localStorage / URL)
subscribeToHostChanges(() => {
  useHostStore.setState({ hostOrigin: getConfiguredHostOrigin() });
});

// Probe immediately and start periodic polling
void useHostStore.getState().refreshStatus();
window.setInterval(() => void useHostStore.getState().refreshStatus(), PROBE_INTERVAL_MS);
window.addEventListener("online", () => void useHostStore.getState().refreshStatus());

// Re-probe when hostOrigin changes
let _prevHostOrigin: string | null = useHostStore.getState().hostOrigin;
useHostStore.subscribe((state) => {
  if (state.hostOrigin === _prevHostOrigin) return;
  _prevHostOrigin = state.hostOrigin;
  void state.refreshStatus();
});
