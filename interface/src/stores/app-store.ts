import { create } from "zustand";
import type { AuraApp } from "../apps/types";
import { apps } from "../apps/registry";

interface AppState {
  apps: AuraApp[];
  activeApp: AuraApp;
}

function getInitialActiveApp(): AuraApp {
  if (typeof window === "undefined") return apps[0];
  const pathname = window.location.pathname;
  return apps.find((a) => pathname.startsWith(a.basePath)) ?? apps[0];
}

export const useAppStore = create<AppState>()(() => ({
  apps,
  activeApp: getInitialActiveApp(),
}));

/**
 * Call from a component inside BrowserRouter to sync pathname → activeApp.
 * Kept as a plain function so it can be called from a useEffect.
 */
export function syncActiveApp(pathname: string): void {
  const match = apps.find((a) => pathname.startsWith(a.basePath)) ?? apps[0];
  const current = useAppStore.getState().activeApp;
  if (current.id !== match.id) {
    useAppStore.setState({ activeApp: match });
  }
}
