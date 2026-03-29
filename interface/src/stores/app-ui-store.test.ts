import { describe, it, expect, beforeEach } from "vitest";
import { useAppUIStore } from "./app-ui-store";

beforeEach(() => {
  useAppUIStore.setState({
    visitedAppIds: new Set<string>(),
    sidebarQuery: "",
    sidebarActions: {},
  });
});

describe("app-ui-store", () => {
  describe("initial state", () => {
    it("has an empty visitedAppIds set", () => {
      expect(useAppUIStore.getState().visitedAppIds.size).toBe(0);
    });

    it("has an empty sidebarQuery", () => {
      expect(useAppUIStore.getState().sidebarQuery).toBe("");
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
    it("updates the sidebarQuery", () => {
      useAppUIStore.getState().setSidebarQuery("hello");
      expect(useAppUIStore.getState().sidebarQuery).toBe("hello");
    });

    it("can clear the sidebarQuery", () => {
      useAppUIStore.getState().setSidebarQuery("test");
      useAppUIStore.getState().setSidebarQuery("");
      expect(useAppUIStore.getState().sidebarQuery).toBe("");
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
