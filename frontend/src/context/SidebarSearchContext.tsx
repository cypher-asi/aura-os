/* eslint-disable react-refresh/only-export-components */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useAppUIStore } from "../stores/app-ui-store";
import { useAppStore } from "../stores/app-store";

type SidebarSearchValue = {
  query: string;
  setQuery: (q: string) => void;
  action: ReactNode;
  setAction: (appId: string, node: ReactNode | null) => void;
};

export function useSidebarSearch(): SidebarSearchValue {
  const activeApp = useAppStore((s) => s.activeApp);
  const storeQuery = useAppUIStore((s) => s.sidebarQuery);
  const setSidebarQuery = useAppUIStore((s) => s.setSidebarQuery);
  const action = useAppUIStore((s) => s.sidebarActions[activeApp.id] ?? null);
  const setAction = useAppUIStore((s) => s.setSidebarAction);

  const prevAppRef = useRef(activeApp.id);
  const appJustSwitched = prevAppRef.current !== activeApp.id;

  useEffect(() => {
    prevAppRef.current = activeApp.id;
    setSidebarQuery("");
  }, [activeApp.id, setSidebarQuery]);

  return { query: appJustSwitched ? "" : storeQuery, setQuery: setSidebarQuery, action, setAction };
}
