import { useCallback } from "react";
import type { ReactNode } from "react";
import { useAppUIStore } from "../stores/app-ui-store";
import { useActiveAppId } from "./use-active-app";

type SidebarSearchValue = {
  query: string;
  setQuery: (q: string) => void;
  action: ReactNode;
  setAction: (appId: string, node: ReactNode | null) => void;
};

export function useSidebarSearch(appIdOverride?: string): SidebarSearchValue {
  const activeAppId = useActiveAppId();
  const appId = appIdOverride ?? activeAppId;
  const storeQuery = useAppUIStore((s) => s.sidebarQueries[appId] ?? "");
  const setSidebarQuery = useAppUIStore((s) => s.setSidebarQuery);
  const action = useAppUIStore((s) => s.sidebarActions[appId] ?? null);
  const setAction = useAppUIStore((s) => s.setSidebarAction);
  const setQuery = useCallback((query: string) => {
    setSidebarQuery(appId, query);
  }, [appId, setSidebarQuery]);

  return { query: storeQuery, setQuery, action, setAction };
}
