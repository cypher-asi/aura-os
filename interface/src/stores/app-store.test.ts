import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockApps, mockSetTaskbarAppOrder } = vi.hoisted(() => ({
  mockApps: [
    { id: "agents", basePath: "/agents", label: "Agents" },
    { id: "projects", basePath: "/projects", label: "Projects" },
    { id: "feed", basePath: "/feed", label: "Feed" },
  ],
  mockSetTaskbarAppOrder: vi.fn(),
}));

vi.mock("../apps/registry", () => ({ apps: mockApps }));
vi.mock("../utils/storage", () => ({
  getTaskbarAppOrder: () => [],
  setTaskbarAppOrder: mockSetTaskbarAppOrder,
}));

import { getOrderedTaskbarApps, useAppStore, syncActiveApp } from "./app-store";

beforeEach(() => {
  mockSetTaskbarAppOrder.mockReset();
  useAppStore.setState({
    apps: mockApps,
    activeApp: mockApps[0],
    taskbarAppOrder: ["agents", "projects", "feed"],
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
    });

    it("does not re-set state when the app already matches", () => {
      const spy = vi.fn();
      useAppStore.subscribe(spy);
      syncActiveApp("/agents/something");
      expect(spy).not.toHaveBeenCalled();
    });

    it("falls back to the first app when no path matches", () => {
      useAppStore.setState({ activeApp: mockApps[1] });
      syncActiveApp("/unknown-route");
      expect(useAppStore.getState().activeApp.id).toBe("agents");
    });
  });

  describe("taskbar app order", () => {
    it("sorts apps using the stored taskbar order", () => {
      const ordered = getOrderedTaskbarApps(mockApps, ["feed", "agents", "projects"]);
      expect(ordered.map((app) => app.id)).toEqual(["feed", "agents", "projects"]);
    });

    it("normalizes and persists a provided taskbar order", () => {
      useAppStore.getState().saveTaskbarAppOrder(["feed", "agents", "feed", "unknown"]);

      expect(useAppStore.getState().taskbarAppOrder).toEqual(["feed", "agents", "projects"]);
      expect(mockSetTaskbarAppOrder).toHaveBeenCalledWith(["feed", "agents", "projects"]);
    });

    it("persists reordered taskbar apps", () => {
      useAppStore.getState().reorderTaskbarApps("feed", "agents");

      expect(useAppStore.getState().taskbarAppOrder).toEqual(["feed", "agents", "projects"]);
      expect(mockSetTaskbarAppOrder).toHaveBeenCalledWith(["feed", "agents", "projects"]);
    });
  });
});
