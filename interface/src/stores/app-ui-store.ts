import { create } from "zustand";
import type { ReactNode } from "react";
import { PREVIOUS_PATH_KEY } from "../constants";

function isValidPreviousPath(path: string | null): path is string {
  return !!path && path !== "/" && !path.startsWith("/desktop");
}

function readPreviousPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(PREVIOUS_PATH_KEY);
    return isValidPreviousPath(value) ? value : null;
  } catch {
    return null;
  }
}

function writePreviousPath(path: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREVIOUS_PATH_KEY, path);
  } catch {
    // ignore storage failures
  }
}

type AppUIState = {
  visitedAppIds: Set<string>;
  sidebarQuery: string;
  sidebarActions: Record<string, ReactNode>;
  sidekickCollapsed: boolean;
  previousPath: string | null;

  markAppVisited: (appId: string) => void;
  setSidebarQuery: (query: string) => void;
  setSidebarAction: (appId: string, node: ReactNode | null) => void;
  toggleSidekick: () => void;
  setPreviousPath: (path: string) => void;
};

export const useAppUIStore = create<AppUIState>()((set) => ({
  visitedAppIds: new Set<string>(),
  sidebarQuery: "",
  sidebarActions: {},
  sidekickCollapsed: false,
  previousPath: readPreviousPath(),

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

  toggleSidekick: (): void => {
    set((s) => ({ sidekickCollapsed: !s.sidekickCollapsed }));
  },

  setPreviousPath: (path): void => {
    if (!isValidPreviousPath(path)) return;
    writePreviousPath(path);
    set({ previousPath: path });
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
