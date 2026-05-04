import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockApps, mockSetTaskbarAppOrder, mockSetTaskbarHiddenAppIds } = vi.hoisted(() => ({
  mockApps: [
    { id: "agents", basePath: "/agents", label: "Agents", preload: vi.fn() },
    { id: "projects", basePath: "/projects", label: "Projects", preload: vi.fn() },
    { id: "tasks", basePath: "/tasks", label: "Tasks", preload: vi.fn() },
    { id: "feed", basePath: "/feed", label: "Feed", preload: vi.fn() },
    {
      id: "feedback",
      basePath: "/feedback",
      label: "Feedback",
      defaultHidden: true,
      preload: vi.fn(),
    },
    { id: "desktop", basePath: "/desktop", label: "Desktop", preload: vi.fn() },
  ],
  mockSetTaskbarAppOrder: vi.fn(),
  mockSetTaskbarHiddenAppIds: vi.fn(),
}));

const mockSetActiveTab = vi.fn();

vi.mock("../apps/registry", () => ({ apps: mockApps }));
vi.mock("../utils/storage", () => ({
  getTaskbarAppOrder: () => [],
  setTaskbarAppOrder: mockSetTaskbarAppOrder,
  // Returning `null` mirrors a fresh user with no saved hidden-apps entry, so
  // the store should fall back to registry-derived `defaultHidden` defaults.
  getTaskbarHiddenAppIds: () => null,
  setTaskbarHiddenAppIds: mockSetTaskbarHiddenAppIds,
}));

import {
  getOrderedTaskbarApps,
  preloadAppForPathname,
  resolveActiveApp,
  useAppStore,
} from "./app-store";

// Capture the store's hydrated initial state BEFORE `beforeEach` resets it,
// so we can assert the registry-derived hidden-apps default seeding.
const initialStoreState = useAppStore.getState();

beforeEach(() => {
  mockSetTaskbarAppOrder.mockReset();
  mockSetTaskbarHiddenAppIds.mockReset();
  mockSetActiveTab.mockReset();
  for (const app of mockApps) {
    app.preload.mockReset();
  }
  useAppStore.setState({
    apps: mockApps,
    taskbarAppOrder: ["agents", "projects", "tasks", "feed"],
    taskbarHiddenAppIds: [],
  });
});

describe("app-store", () => {
  describe("initial state", () => {
    it("contains all registered apps", () => {
      expect(useAppStore.getState().apps).toEqual(mockApps);
    });
  });

  describe("preloadAppForPathname", () => {
    it("preloads the app that owns the pathname", () => {
      preloadAppForPathname("/projects/123");
      expect(mockApps[1].preload).toHaveBeenCalledTimes(1);
    });

    it("falls back to the first app when no path matches", () => {
      preloadAppForPathname("/unknown-route");
      expect(mockApps[0].preload).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveActiveApp", () => {
    it("uses the route path directly", () => {
      expect(resolveActiveApp("/").id).toBe("agents");
      expect(resolveActiveApp("/desktop").id).toBe("desktop");
    });

    it("does not treat /feedback as the /feed app (strict basePath match)", () => {
      expect(resolveActiveApp("/feed").id).toBe("feed");
      expect(resolveActiveApp("/feed/activity").id).toBe("feed");
      expect(resolveActiveApp("/feedback").id).toBe("feedback");
      expect(resolveActiveApp("/feedback/fb-1").id).toBe("feedback");
    });
  });

  describe("taskbar app order", () => {
    it("sorts apps using the stored taskbar order", () => {
      const ordered = getOrderedTaskbarApps(mockApps, ["feed", "agents", "projects", "tasks", "feedback"]);
      expect(ordered.map((app) => app.id)).toEqual(["feed", "agents", "projects", "tasks", "feedback", "desktop"]);
    });

    it("normalizes and persists a provided taskbar order", () => {
      useAppStore.getState().saveTaskbarAppOrder(["feed", "agents", "feed", "unknown"]);

      expect(useAppStore.getState().taskbarAppOrder).toEqual(["feed", "agents", "projects", "tasks", "feedback"]);
      expect(mockSetTaskbarAppOrder).toHaveBeenCalledWith(["feed", "agents", "projects", "tasks", "feedback"]);
    });

    it("persists reordered taskbar apps", () => {
      useAppStore.getState().reorderTaskbarApps("feed", "agents");

      expect(useAppStore.getState().taskbarAppOrder).toEqual(["feed", "agents", "projects", "tasks", "feedback"]);
      expect(mockSetTaskbarAppOrder).toHaveBeenCalledWith(["feed", "agents", "projects", "tasks", "feedback"]);
    });
  });

  describe("taskbar hidden apps", () => {
    it("seeds hidden ids from registry defaultHidden flags when storage has no entry", () => {
      // `feedback` is the only mock app marked `defaultHidden: true`, and the
      // storage mock returns `null` — so initial hydration should hide it.
      expect(initialStoreState.taskbarHiddenAppIds).toEqual(["feedback"]);
    });

    it("normalizes hidden ids, dropping unknown + pinned apps", () => {
      useAppStore
        .getState()
        .saveTaskbarHiddenAppIds(["feed", "desktop", "profile", "unknown", "feed"]);

      expect(useAppStore.getState().taskbarHiddenAppIds).toEqual(["feed"]);
      expect(mockSetTaskbarHiddenAppIds).toHaveBeenCalledWith(["feed"]);
    });

    it("persists an explicit empty hidden list (so defaults don't reseed later)", () => {
      useAppStore.getState().saveTaskbarHiddenAppIds([]);

      expect(useAppStore.getState().taskbarHiddenAppIds).toEqual([]);
      expect(mockSetTaskbarHiddenAppIds).toHaveBeenCalledWith([]);
    });

    it("persists order + hidden atomically via saveTaskbarAppsLayout", () => {
      useAppStore
        .getState()
        .saveTaskbarAppsLayout(
          ["agents", "feedback", "projects", "tasks", "feed"],
          ["feedback", "tasks"],
        );

      expect(useAppStore.getState().taskbarAppOrder).toEqual([
        "agents",
        "feedback",
        "projects",
        "tasks",
        "feed",
      ]);
      expect(useAppStore.getState().taskbarHiddenAppIds).toEqual(["feedback", "tasks"]);
      expect(mockSetTaskbarAppOrder).toHaveBeenCalledWith([
        "agents",
        "feedback",
        "projects",
        "tasks",
        "feed",
      ]);
      expect(mockSetTaskbarHiddenAppIds).toHaveBeenCalledWith(["feedback", "tasks"]);
    });

    it("preserves order when an app is unhidden later", () => {
      useAppStore
        .getState()
        .saveTaskbarAppsLayout(
          ["agents", "projects", "tasks", "feed", "feedback"],
          ["tasks"],
        );
      useAppStore.getState().saveTaskbarHiddenAppIds([]);

      expect(useAppStore.getState().taskbarAppOrder).toEqual([
        "agents",
        "projects",
        "tasks",
        "feed",
        "feedback",
      ]);
      expect(useAppStore.getState().taskbarHiddenAppIds).toEqual([]);
    });
  });
});
