import { create } from "zustand";
import type { AuraApp } from "../apps/types";
import { apps as registeredApps } from "../apps/registry";
import {
  getTaskbarAppOrder,
  getTaskbarHiddenAppIds,
  setTaskbarAppOrder,
  setTaskbarHiddenAppIds,
} from "../utils/storage";

interface AppState {
  apps: AuraApp[];
  taskbarAppOrder: string[];
  taskbarHiddenAppIds: string[];
  saveTaskbarAppOrder: (nextOrder: string[]) => void;
  saveTaskbarHiddenAppIds: (nextHidden: string[]) => void;
  saveTaskbarAppsLayout: (nextOrder: string[], nextHidden: string[]) => void;
  reorderTaskbarApps: (activeId: string, overId: string) => void;
}

function matchesBasePath(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

/**
 * Resolve which `AuraApp` owns a given pathname. This is the single source of
 * truth for "which app is active" — shells and chrome derive their state from
 * this via the {@link useActiveApp} hook instead of mirroring it into store
 * state. Keeping the lookup synchronous prevents the one-render lag that used
 * to let the outgoing panel run URL-driven effects during a route transition.
 */
export function resolveActiveApp(pathname: string): AuraApp {
  return (
    registeredApps.find((a) => matchesBasePath(pathname, a.basePath)) ??
    registeredApps[0]
  );
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

function normalizeTaskbarHiddenAppIds(apps: AuraApp[], savedIds: string[]): string[] {
  // Only reorderable (non-pinned) apps can be hidden; `desktop` and `profile`
  // live outside the reorderable strip and are always visible.
  const reorderableIds = new Set(
    apps.filter((app) => !isPinnedTaskbarApp(app)).map((app) => app.id),
  );
  const hidden: string[] = [];
  for (const id of savedIds) {
    if (!reorderableIds.has(id) || hidden.includes(id)) continue;
    hidden.push(id);
  }
  return hidden;
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

function getInitialTaskbarHiddenAppIds(): string[] {
  const savedIds = typeof window === "undefined" ? [] : getTaskbarHiddenAppIds();
  return normalizeTaskbarHiddenAppIds(registeredApps, savedIds);
}

export const useAppStore = create<AppState>()((set, get) => ({
  apps: registeredApps,
  taskbarAppOrder: getInitialTaskbarAppOrder(),
  taskbarHiddenAppIds: getInitialTaskbarHiddenAppIds(),
  saveTaskbarAppOrder: (nextOrder: string[]) => {
    const normalizedOrder = normalizeTaskbarAppOrder(get().apps, nextOrder);
    setTaskbarAppOrder(normalizedOrder);
    set({ taskbarAppOrder: normalizedOrder });
  },
  saveTaskbarHiddenAppIds: (nextHidden: string[]) => {
    const normalizedHidden = normalizeTaskbarHiddenAppIds(get().apps, nextHidden);
    setTaskbarHiddenAppIds(normalizedHidden);
    set({ taskbarHiddenAppIds: normalizedHidden });
  },
  saveTaskbarAppsLayout: (nextOrder: string[], nextHidden: string[]) => {
    const apps = get().apps;
    const normalizedOrder = normalizeTaskbarAppOrder(apps, nextOrder);
    const normalizedHidden = normalizeTaskbarHiddenAppIds(apps, nextHidden);
    setTaskbarAppOrder(normalizedOrder);
    setTaskbarHiddenAppIds(normalizedHidden);
    set({
      taskbarAppOrder: normalizedOrder,
      taskbarHiddenAppIds: normalizedHidden,
    });
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
 * Eagerly preload the app that owns a pathname. Called from the router-aware
 * sync effect so panels can start their lazy imports the moment we know the
 * pathname — without coupling the shell to a mutable `activeApp` store field.
 */
export function preloadAppForPathname(pathname: string): void {
  resolveActiveApp(pathname).preload?.();
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
