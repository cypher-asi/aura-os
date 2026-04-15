import { create } from "zustand";
import type { AuraApp } from "../apps/types";
import { apps as registeredApps } from "../apps/registry";
import { getTaskbarAppOrder, setTaskbarAppOrder } from "../utils/storage";

interface AppState {
  apps: AuraApp[];
  activeApp: AuraApp;
  taskbarAppOrder: string[];
  saveTaskbarAppOrder: (nextOrder: string[]) => void;
  reorderTaskbarApps: (activeId: string, overId: string) => void;
}

function getInitialActiveApp(): AuraApp {
  if (typeof window === "undefined") return registeredApps[0];
  const pathname = window.location.pathname;
  const initialApp = registeredApps.find((a) => pathname.startsWith(a.basePath)) ?? registeredApps[0];
  initialApp.preload?.();
  return initialApp;
}

function isPinnedTaskbarApp(app: AuraApp): boolean {
  return app.id === "desktop" || app.id === "profile";
}

function normalizeTaskbarAppOrder(apps: AuraApp[], savedIds: string[]): string[] {
  const defaultIds = apps.filter((app) => !isPinnedTaskbarApp(app)).map((app) => app.id);
  const knownIds = new Set(defaultIds);
  const normalizedIds: string[] = [];

  for (const id of savedIds) {
    if (!knownIds.has(id) || normalizedIds.includes(id)) continue;
    normalizedIds.push(id);
  }

  for (const id of defaultIds) {
    if (!normalizedIds.includes(id)) normalizedIds.push(id);
  }

  return normalizedIds;
}

function moveItem(ids: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex) return ids;
  const nextIds = [...ids];
  const [movedId] = nextIds.splice(fromIndex, 1);
  nextIds.splice(toIndex, 0, movedId);
  return nextIds;
}

function getInitialTaskbarAppOrder(): string[] {
  const savedIds = typeof window === "undefined" ? [] : getTaskbarAppOrder();
  return normalizeTaskbarAppOrder(registeredApps, savedIds);
}

export const useAppStore = create<AppState>()((set, get) => ({
  apps: registeredApps,
  activeApp: getInitialActiveApp(),
  taskbarAppOrder: getInitialTaskbarAppOrder(),
  saveTaskbarAppOrder: (nextOrder: string[]) => {
    const normalizedOrder = normalizeTaskbarAppOrder(get().apps, nextOrder);
    setTaskbarAppOrder(normalizedOrder);
    set({ taskbarAppOrder: normalizedOrder });
  },
  reorderTaskbarApps: (activeId: string, overId: string) => {
    if (activeId === overId) return;

    const state = get();
    const currentOrder = normalizeTaskbarAppOrder(state.apps, state.taskbarAppOrder);
    const fromIndex = currentOrder.indexOf(activeId);
    const toIndex = currentOrder.indexOf(overId);

    if (fromIndex === -1 || toIndex === -1) return;

    const nextOrder = moveItem(currentOrder, fromIndex, toIndex);
    state.saveTaskbarAppOrder(nextOrder);
  },
}));

/**
 * Call from a component inside BrowserRouter to sync pathname → activeApp.
 * Kept as a plain function so it can be called from a useEffect.
 */
export function syncActiveApp(pathname: string): void {
  const match = registeredApps.find((a) => pathname.startsWith(a.basePath)) ?? registeredApps[0];
  match.preload?.();
  const current = useAppStore.getState().activeApp;
  if (current.id !== match.id) {
    useAppStore.setState({ activeApp: match });
  }
}

export function getOrderedTaskbarApps(apps: AuraApp[], taskbarAppOrder: string[]): AuraApp[] {
  const rank = new Map(taskbarAppOrder.map((id, index) => [id, index]));

  return [...apps].sort((a, b) => {
    const aRank = rank.get(a.id);
    const bRank = rank.get(b.id);

    if (aRank == null && bRank == null) return 0;
    if (aRank == null) return 1;
    if (bRank == null) return -1;
    return aRank - bRank;
  });
}
