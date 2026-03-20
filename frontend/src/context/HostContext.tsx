/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getConfiguredHostOrigin,
  getHostDisplayLabel,
  getResolvedHostOrigin,
  resolveApiUrl,
  setConfiguredHostOrigin,
  subscribeToHostChanges,
} from "../lib/host-config";

export type HostConnectionStatus = "checking" | "online" | "auth_required" | "unreachable" | "error";

interface HostContextValue {
  hostOrigin: string | null;
  resolvedOrigin: string;
  hostLabel: string;
  status: HostConnectionStatus;
  lastCheckedAt: number | null;
  setHostOrigin: (value: string | null) => string | null;
  refreshStatus: () => Promise<void>;
}

const HostContext = createContext<HostContextValue | null>(null);
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

export function HostProvider({ children }: { children: ReactNode }) {
  const [hostOrigin, setHostOriginState] = useState<string | null>(() => getConfiguredHostOrigin());
  const [status, setStatus] = useState<HostConnectionStatus>("checking");
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const probeInFlight = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (probeInFlight.current) return;
    probeInFlight.current = true;
    setStatus((prev) => (prev === "checking" ? prev : "checking"));

    try {
      const next = await probeHost();
      setStatus(next);
      setLastCheckedAt(Date.now());
    } finally {
      probeInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    return subscribeToHostChanges(() => {
      setHostOriginState(getConfiguredHostOrigin());
    });
  }, []);

  useEffect(() => {
    void refreshStatus();

    const interval = window.setInterval(() => {
      void refreshStatus();
    }, PROBE_INTERVAL_MS);

    const onOnline = () => {
      void refreshStatus();
    };

    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
    };
  }, [hostOrigin, refreshStatus]);

  const setHostOrigin = useCallback((value: string | null) => {
    const next = setConfiguredHostOrigin(value);
    setHostOriginState(next);
    return next;
  }, []);

  const value = useMemo(
    () => ({
      hostOrigin,
      resolvedOrigin: getResolvedHostOrigin(),
      hostLabel: getHostDisplayLabel(),
      status,
      lastCheckedAt,
      setHostOrigin,
      refreshStatus,
    }),
    [hostOrigin, lastCheckedAt, refreshStatus, setHostOrigin, status],
  );

  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useHost(): HostContextValue {
  const ctx = useContext(HostContext);
  if (!ctx) throw new Error("useHost must be used within HostProvider");
  return ctx;
}
