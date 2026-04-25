/**
 * App-level route/sync helpers. Realtime work (event socket, profile/follow subscriptions) is not
 * initialized at module load; it runs from auth-store after session restore or login via
 * `loadAndRunShellRealtimeBootstrap` and `scheduleDeferredEventSocketConnect`.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { desktopApi } from "../../shared/api/desktop";
import { preloadAppForPathname, resolveActiveApp } from "../../stores/app-store";
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

    // Active app is derived from the pathname (see `useActiveApp`) — this
    // effect only handles the cross-cutting side-effects (prefetch, last-app
    // persistence, visited tracking) that belong to "entered a new app".
    preloadAppForPathname(pathname);
    const activeAppId = resolveActiveApp(pathname).id;
    markAppVisited(activeAppId);
    setLastApp(activeAppId);
  }, [hash, pathname, search, markAppVisited, setPreviousPath]);

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
