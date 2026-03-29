import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockApps } = vi.hoisted(() => ({
  mockApps: [
    { id: "agents", basePath: "/agents", label: "Agents" },
    { id: "projects", basePath: "/projects", label: "Projects" },
    { id: "feed", basePath: "/feed", label: "Feed" },
  ],
}));

vi.mock("../apps/registry", () => ({ apps: mockApps }));

import { useAppStore, syncActiveApp } from "./app-store";

beforeEach(() => {
  useAppStore.setState({ apps: mockApps, activeApp: mockApps[0] });
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
});
