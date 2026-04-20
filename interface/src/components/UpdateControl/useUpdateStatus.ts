import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { DesktopUpdateStatusResponse } from "../../api/desktop";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";

const POLL_INTERVAL = 5_000;

const TERMINAL_STATUSES = new Set([
  "up_to_date",
  "available",
  "failed",
  "idle",
]);

export type UpdateStatusValue =
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "up_to_date"
  | "failed"
  | "idle"
  | "unknown";

export interface UpdateStatusState {
  supported: boolean;
  loaded: boolean;
  status: UpdateStatusValue;
  currentVersion: string | null;
  availableVersion: string | null;
  error: string | null;
  lastCheckedAt: number | null;
  checkPending: boolean;
  installPending: boolean;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

export function useUpdateStatus(): UpdateStatusState {
  const { features } = useAuraCapabilities();
  const [data, setData] = useState<DesktopUpdateStatusResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [checkPending, setCheckPending] = useState(false);
  const [installPending, setInstallPending] = useState(false);
  const mountedRef = useRef(true);

  const supported = !!features.nativeUpdater && data?.supported !== false;

  const poll = useCallback(async () => {
    try {
      const next = await api.getUpdateStatus();
      if (!mountedRef.current) return;
      setData(next);
      setLoaded(true);
      if (TERMINAL_STATUSES.has(next.update.status)) {
        setLastCheckedAt(Date.now());
      }
      if (next.update.status !== "checking") {
        setCheckPending(false);
      }
      if (next.update.status !== "available") {
        setInstallPending(false);
      }
    } catch {
      if (mountedRef.current) {
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!features.nativeUpdater) return;
    void poll();
  }, [features.nativeUpdater, poll]);

  useEffect(() => {
    if (!features.nativeUpdater) return;
    if (data?.supported === false) return;
    const id = setInterval(() => {
      void poll();
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [features.nativeUpdater, data?.supported, poll]);

  const checkForUpdates = useCallback(async () => {
    if (!features.nativeUpdater) return;
    setCheckPending(true);
    try {
      await api.checkForUpdates();
      await poll();
    } catch {
      if (mountedRef.current) {
        setCheckPending(false);
      }
    }
  }, [features.nativeUpdater, poll]);

  const installUpdate = useCallback(async () => {
    if (!features.nativeUpdater) return;
    setInstallPending(true);
    try {
      await api.installUpdate();
      await poll();
    } catch {
      if (mountedRef.current) {
        setInstallPending(false);
      }
    }
  }, [features.nativeUpdater, poll]);

  const status = (data?.update.status ?? "unknown") as UpdateStatusValue;
  const availableVersion = data?.update.version ?? null;
  const currentVersion = data?.current_version ?? null;
  const error = data?.update.error ?? null;

  return {
    supported,
    loaded,
    status,
    currentVersion,
    availableVersion,
    error,
    lastCheckedAt,
    checkPending,
    installPending,
    checkForUpdates,
    installUpdate,
  };
}
