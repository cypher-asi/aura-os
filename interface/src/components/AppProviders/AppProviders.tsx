import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { syncActiveApp, useAppStore } from "../../stores/app-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { setLastApp } from "../../utils/storage";

function AppSync(): null {
  const { pathname } = useLocation();
  const markAppVisited = useAppUIStore((s) => s.markAppVisited);

  useEffect(() => {
    syncActiveApp(pathname);
    markAppVisited(useAppStore.getState().activeApp.id);
  }, [pathname, markAppVisited]);

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
