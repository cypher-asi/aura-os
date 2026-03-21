import { create } from "zustand";
import type { ReactNode } from "react";

type AppUIState = {
  visitedAppIds: Set<string>;
  sidebarQuery: string;
  sidebarActions: Record<string, ReactNode>;

  markAppVisited: (appId: string) => void;
  setSidebarQuery: (query: string) => void;
  setSidebarAction: (appId: string, node: ReactNode | null) => void;
};

export const useAppUIStore = create<AppUIState>()((set) => ({
  visitedAppIds: new Set<string>(),
  sidebarQuery: "",
  sidebarActions: {},

  markAppVisited: (appId): void => {
    set((s) => {
      if (s.visitedAppIds.has(appId)) return s;
      const next = new Set(s.visitedAppIds);
      next.add(appId);
      return { visitedAppIds: next };
    });
  },

  setSidebarQuery: (query): void => {
    set({ sidebarQuery: query });
  },

  setSidebarAction: (appId, node): void => {
    set((s) => {
      if (node === null) {
        const { [appId]: _, ...rest } = s.sidebarActions;
        return { sidebarActions: rest };
      }
      return { sidebarActions: { ...s.sidebarActions, [appId]: node } };
    });
  },
}));
