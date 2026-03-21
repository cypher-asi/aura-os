import { create } from "zustand";

type AppUIState = {
  visitedAppIds: Set<string>;
  sidebarQuery: string;

  markAppVisited: (appId: string) => void;
  setSidebarQuery: (query: string) => void;
};

export const useAppUIStore = create<AppUIState>()((set) => ({
  visitedAppIds: new Set<string>(),
  sidebarQuery: "",

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
}));
