/* eslint-disable react-refresh/only-export-components */
import { useEffect } from "react";
import type { ReactNode } from "react";
import { useAppUIStore } from "../stores/app-ui-store";
import { useSidebarAction } from "./SidebarActionContext";
import { useAppContext } from "./AppContext";

type SidebarSearchValue = {
  query: string;
  setQuery: (q: string) => void;
  action: ReactNode;
  setAction: (appId: string, node: ReactNode | null) => void;
};

export function useSidebarSearch(): SidebarSearchValue {
  const { activeApp } = useAppContext();
  const query = useAppUIStore((s) => s.sidebarQuery);
  const setSidebarQuery = useAppUIStore((s) => s.setSidebarQuery);
  const { action, setAction } = useSidebarAction();

  useEffect(() => {
    setSidebarQuery("");
  }, [activeApp.id, setSidebarQuery]);

  return { query, setQuery: setSidebarQuery, action, setAction };
}
