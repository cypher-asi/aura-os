import { describe, it, expect, beforeEach } from "vitest";
import { useAppUIStore } from "./app-ui-store";

beforeEach(() => {
  useAppUIStore.setState({
    visitedAppIds: new Set<string>(),
    sidebarQueries: {},
    sidebarActions: {},
  });
});

describe("app-ui-store", () => {
  describe("initial state", () => {
    it("has an empty visitedAppIds set", () => {
      expect(useAppUIStore.getState().visitedAppIds.size).toBe(0);
    });

    it("has no sidebarQueries", () => {
      expect(useAppUIStore.getState().sidebarQueries).toEqual({});
    });

    it("has no sidebarActions", () => {
      expect(useAppUIStore.getState().sidebarActions).toEqual({});
    });
  });

  describe("markAppVisited", () => {
    it("adds an app id to visitedAppIds", () => {
      useAppUIStore.getState().markAppVisited("feed");
      expect(useAppUIStore.getState().visitedAppIds.has("feed")).toBe(true);
    });

    it("is idempotent for the same id", () => {
      const { markAppVisited } = useAppUIStore.getState();
      markAppVisited("feed");
      const first = useAppUIStore.getState().visitedAppIds;
      markAppVisited("feed");
      const second = useAppUIStore.getState().visitedAppIds;
      expect(first).toBe(second);
    });

    it("accumulates multiple distinct ids", () => {
      const { markAppVisited } = useAppUIStore.getState();
      markAppVisited("feed");
      markAppVisited("agents");
      const ids = useAppUIStore.getState().visitedAppIds;
      expect(ids.has("feed")).toBe(true);
      expect(ids.has("agents")).toBe(true);
      expect(ids.size).toBe(2);
    });
  });

  describe("setSidebarQuery", () => {
    it("updates the query for one app without touching others", () => {
      useAppUIStore.getState().setSidebarQuery("projects", "hello");
      useAppUIStore.getState().setSidebarQuery("tasks", "backlog");

      expect(useAppUIStore.getState().sidebarQueries).toEqual({
        projects: "hello",
        tasks: "backlog",
      });
    });

    it("can clear a single app query without removing others", () => {
      useAppUIStore.getState().setSidebarQuery("projects", "test");
      useAppUIStore.getState().setSidebarQuery("tasks", "running");
      useAppUIStore.getState().setSidebarQuery("projects", "");

      expect(useAppUIStore.getState().sidebarQueries).toEqual({
        projects: "",
        tasks: "running",
      });
    });
  });

  describe("setSidebarAction", () => {
    it("adds a sidebar action for an app", () => {
      useAppUIStore.getState().setSidebarAction("feed", "some-node");
      expect(useAppUIStore.getState().sidebarActions).toEqual({ feed: "some-node" });
    });

    it("removes a sidebar action when node is null", () => {
      useAppUIStore.getState().setSidebarAction("feed", "some-node");
      useAppUIStore.getState().setSidebarAction("feed", null);
      expect(useAppUIStore.getState().sidebarActions).toEqual({});
    });

    it("preserves other actions when removing one", () => {
      useAppUIStore.getState().setSidebarAction("feed", "node-a");
      useAppUIStore.getState().setSidebarAction("agents", "node-b");
      useAppUIStore.getState().setSidebarAction("feed", null);
      expect(useAppUIStore.getState().sidebarActions).toEqual({ agents: "node-b" });
    });
  });
});
