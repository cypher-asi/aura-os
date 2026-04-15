/**
 * App-level route/sync helpers. Realtime work (event socket, profile/follow subscriptions) is not
 * initialized at module load; it runs from auth-store after session restore or login via
 * `loadAndRunShellRealtimeBootstrap` and `scheduleDeferredEventSocketConnect`.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { syncActiveApp, useAppStore } from "../../stores/app-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { setLastApp } from "../../utils/storage";

function AppSync(): null {
  const { pathname, search, hash } = useLocation();
  const markAppVisited = useAppUIStore((s) => s.markAppVisited);

  const setPreviousPath = useAppUIStore((s) => s.setPreviousPath);

  useEffect(() => {
    if (pathname !== "/" && !pathname.startsWith("/desktop")) {
      setPreviousPath(`${pathname}${search}${hash}`);
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
