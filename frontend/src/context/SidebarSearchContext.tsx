/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useAppContext } from "./AppContext";

interface SidebarSearchContextValue {
  query: string;
  setQuery: (q: string) => void;
  action: ReactNode;
  setAction: (appId: string, node: ReactNode | null) => void;
}

const SidebarSearchCtx = createContext<SidebarSearchContextValue>({
  query: "",
  setQuery: () => {},
  action: null,
  setAction: () => {},
});

export function SidebarSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQueryRaw] = useState("");
  const [actionsMap, setActionsMap] = useState<Record<string, ReactNode>>({});
  const { activeApp } = useAppContext();

  useEffect(() => {
    setQueryRaw("");
  }, [activeApp.id]);

  const setQuery = useCallback((q: string) => setQueryRaw(q), []);
  const setAction = useCallback((appId: string, node: ReactNode | null) => {
    setActionsMap((prev) => {
      if (node === null) {
        const { [appId]: removedAction, ...rest } = prev;
        void removedAction;
        return rest;
      }
      return { ...prev, [appId]: node };
    });
  }, []);

  const action = useMemo(() => actionsMap[activeApp.id] ?? null, [actionsMap, activeApp.id]);

  return (
    <SidebarSearchCtx.Provider value={{ query, setQuery, action, setAction }}>
      {children}
    </SidebarSearchCtx.Provider>
  );
}

export function useSidebarSearch() {
  return useContext(SidebarSearchCtx);
}
