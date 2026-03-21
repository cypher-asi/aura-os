/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useAppContext } from "./AppContext";

type SidebarActionContextValue = {
  action: ReactNode;
  setAction: (appId: string, node: ReactNode | null) => void;
};

const SidebarActionCtx = createContext<SidebarActionContextValue | null>(null);

export function SidebarActionProvider({ children }: { children: ReactNode }): ReactNode {
  const { activeApp } = useAppContext();
  const [actionsMap, setActionsMap] = useState<Record<string, ReactNode>>({});

  const setAction = useCallback((appId: string, node: ReactNode | null) => {
    setActionsMap((prev) => {
      if (node === null) {
        const { [appId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [appId]: node };
    });
  }, []);

  return (
    <SidebarActionCtx.Provider value={{ action: actionsMap[activeApp.id] ?? null, setAction }}>
      {children}
    </SidebarActionCtx.Provider>
  );
}

export function useSidebarAction(): SidebarActionContextValue {
  const ctx = useContext(SidebarActionCtx);
  if (!ctx) throw new Error("useSidebarAction requires SidebarActionProvider");
  return ctx;
}
