/**
 * App-level route/sync helpers. Realtime work (event socket, profile/follow subscriptions) is not
 * initialized at module load; it runs from auth-store after session restore or login via
 * `loadAndRunShellRealtimeBootstrap` and `scheduleDeferredEventSocketConnect`.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { desktopApi } from "../../api/desktop";
import { syncActiveApp, useAppStore } from "../../stores/app-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { sanitizeRestorePath } from "../../utils/last-app-path";
import { setLastApp } from "../../utils/storage";

function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && typeof window.ipc?.postMessage === "function";
}

function AppSync(): null {
  const { pathname, search, hash } = useLocation();
  const markAppVisited = useAppUIStore((s) => s.markAppVisited);

  const setPreviousPath = useAppUIStore((s) => s.setPreviousPath);

  useEffect(() => {
    const restorePath = sanitizeRestorePath(`${pathname}${search}${hash}`);

    if (restorePath) {
      setPreviousPath(restorePath);
      if (hasDesktopBridge()) {
        void desktopApi.persistLastRoute(restorePath).catch(() => {});
      }
    }
    syncActiveApp(pathname);
    const activeAppIdAfterSync = useAppStore.getState().activeApp.id;
    markAppVisited(activeAppIdAfterSync);
  }, [hash, pathname, search, markAppVisited, setPreviousPath]);

  const activeAppId = useAppStore((s) => s.activeApp.id);

  useEffect(() => {
    markAppVisited(activeAppId);
    setLastApp(activeAppId);
  }, [activeAppId, markAppVisited]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppSync />
      {children}
    </>
  );
}
