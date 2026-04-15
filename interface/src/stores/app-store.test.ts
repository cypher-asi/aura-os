import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockApps, mockSetTaskbarAppOrder } = vi.hoisted(() => ({
  mockApps: [
    { id: "agents", basePath: "/agents", label: "Agents", preload: vi.fn() },
    { id: "projects", basePath: "/projects", label: "Projects", preload: vi.fn() },
    { id: "tasks", basePath: "/tasks", label: "Tasks", preload: vi.fn() },
    { id: "feed", basePath: "/feed", label: "Feed", preload: vi.fn() },
  ],
  mockSetTaskbarAppOrder: vi.fn(),
}));

const mockSetActiveTab = vi.fn();

vi.mock("../apps/registry", () => ({ apps: mockApps }));
vi.mock("../utils/storage", () => ({
  getTaskbarAppOrder: () => [],
  setTaskbarAppOrder: mockSetTaskbarAppOrder,
}));
vi.mock("./sidekick-store", () => ({
  useSidekickStore: {
    getState: () => ({
      setActiveTab: mockSetActiveTab,
    }),
  },
}));

import { getOrderedTaskbarApps, useAppStore, syncActiveApp } from "./app-store";

beforeEach(() => {
  mockSetTaskbarAppOrder.mockReset();
  mockSetActiveTab.mockReset();
  for (const app of mockApps) {
    app.preload.mockReset();
  }
  useAppStore.setState({
    apps: mockApps,
    activeApp: mockApps[0],
    taskbarAppOrder: ["agents", "projects", "tasks", "feed"],
  });
});

describe("app-store", () => {
  describe("initial state", () => {
    it("contains all registered apps", () => {
      expect(useAppStore.getState().apps).toEqual(mockApps);
    });

    it("has an activeApp defaulting to the first app", () => {
      expect(useAppStore.getState().activeApp.id).toBe("agents");
    });
  });

  describe("syncActiveApp", () => {
    it("switches activeApp when pathname matches a different app", () => {
      syncActiveApp("/projects/123");
      expect(useAppStore.getState().activeApp.id).toBe("projects");
      expect(mockApps[1].preload).toHaveBeenCalledTimes(1);
      expect(mockSetActiveTab).not.toHaveBeenCalled();
    });

    it("selects the tasks sidekick tab when entering the tasks app", () => {
      syncActiveApp("/tasks/123");
      expect(useAppStore.getState().activeApp.id).toBe("tasks");
      expect(mockApps[2].preload).toHaveBeenCalledTimes(1);
      expect(mockSetActiveTab).toHaveBeenCalledWith("tasks");
    });

    it("does not re-set state when the app already matches", () => {
      const spy = vi.fn();
      useAppStore.subscribe(spy);
      syncActiveApp("/agents/something");
      expect(spy).not.toHaveBeenCalled();
      expect(mockSetActiveTab).not.toHaveBeenCalled();
    });

    it("falls back to the first app when no path matches", () => {
      useAppStore.setState({ activeApp: mockApps[1] });
      syncActiveApp("/unknown-route");
      expect(useAppStore.getState().activeApp.id).toBe("agents");
      expect(mockApps[0].preload).toHaveBeenCalledTimes(1);
      expect(mockSetActiveTab).not.toHaveBeenCalled();
    });
  });

  describe("taskbar app order", () => {
    it("sorts apps using the stored taskbar order", () => {
      const ordered = getOrderedTaskbarApps(mockApps, ["feed", "agents", "projects", "tasks"]);
      expect(ordered.map((app) => app.id)).toEqual(["feed", "agents", "projects", "tasks"]);
    });

    it("normalizes and persists a provided taskbar order", () => {
      useAppStore.getState().saveTaskbarAppOrder(["feed", "agents", "feed", "unknown"]);

      expect(useAppStore.getState().taskbarAppOrder).toEqual(["feed", "agents", "projects", "tasks"]);
      expect(mockSetTaskbarAppOrder).toHaveBeenCalledWith(["feed", "agents", "projects", "tasks"]);
    });

    it("persists reordered taskbar apps", () => {
      useAppStore.getState().reorderTaskbarApps("feed", "agents");

      expect(useAppStore.getState().taskbarAppOrder).toEqual(["feed", "agents", "projects", "tasks"]);
      expect(mockSetTaskbarAppOrder).toHaveBeenCalledWith(["feed", "agents", "projects", "tasks"]);
    });
  });
});
