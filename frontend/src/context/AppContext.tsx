/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo } from "react";
import { useLocation } from "react-router-dom";
import type { AuraApp } from "../apps/types";
import type { ReactNode } from "react";

interface AppContextValue {
  apps: AuraApp[];
  activeApp: AuraApp;
}

const AppCtx = createContext<AppContextValue | null>(null);

export function AppProvider({ apps, children }: { apps: AuraApp[]; children: ReactNode }) {
  const { pathname } = useLocation();

  const activeApp = useMemo(() => {
    const match = apps.find((a) => pathname.startsWith(a.basePath));
    return match ?? apps[0];
  }, [apps, pathname]);

  const value = useMemo(() => ({ apps, activeApp }), [apps, activeApp]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
