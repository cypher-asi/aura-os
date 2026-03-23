import { getLastAgent, setLastAgent, clearLastAgentIf, getLastProject, setLastProject } from "./storage";

const LAST_AGENT_KEY = "aura-last-agent";
const LAST_PROJECT_KEY = "aura-last-project";

describe("storage", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getLastAgent", () => {
    it("returns null when no data stored", () => {
      expect(getLastAgent("p1")).toBeNull();
    });

    it("returns agentInstanceId for the given project", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1", p2: "ai-2" });
      expect(getLastAgent("p1")).toBe("ai-1");
      expect(getLastAgent("p2")).toBe("ai-2");
    });

    it("returns null for an unknown project", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      expect(getLastAgent("p999")).toBeNull();
    });

    it("returns null for malformed JSON", () => {
      store[LAST_AGENT_KEY] = "not-json";
      expect(getLastAgent("p1")).toBeNull();
    });

    it("returns null for non-object values", () => {
      store[LAST_AGENT_KEY] = JSON.stringify([1, 2, 3]);
      expect(getLastAgent("p1")).toBeNull();
    });

    it("returns null for empty object", () => {
      store[LAST_AGENT_KEY] = "{}";
      expect(getLastAgent("p1")).toBeNull();
    });
  });

  describe("setLastAgent", () => {
    it("stores a single project entry", () => {
      setLastAgent("p1", "ai-1");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_AGENT_KEY,
        JSON.stringify({ p1: "ai-1" }),
      );
    });

    it("preserves entries for other projects", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      setLastAgent("p2", "ai-2");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_AGENT_KEY,
        JSON.stringify({ p1: "ai-1", p2: "ai-2" }),
      );
    });

    it("overwrites the entry for an existing project", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      setLastAgent("p1", "ai-99");
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LAST_AGENT_KEY,
        JSON.stringify({ p1: "ai-99" }),
      );
    });
  });

  describe("clearLastAgentIf", () => {
    it("removes entry when projectId matches", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1", p2: "ai-2" });
      clearLastAgentIf({ projectId: "p1" });
      expect(store[LAST_AGENT_KEY]).toBe(JSON.stringify({ p2: "ai-2" }));
    });

    it("removes all entries matching agentInstanceId", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1", p2: "ai-1", p3: "ai-3" });
      clearLastAgentIf({ agentInstanceId: "ai-1" });
      expect(store[LAST_AGENT_KEY]).toBe(JSON.stringify({ p3: "ai-3" }));
    });

    it("removes localStorage key entirely when map becomes empty", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      clearLastAgentIf({ projectId: "p1" });
      expect(localStorage.removeItem).toHaveBeenCalledWith(LAST_AGENT_KEY);
    });

    it("does not modify storage when nothing matches", () => {
      store[LAST_AGENT_KEY] = JSON.stringify({ p1: "ai-1" });
      clearLastAgentIf({ projectId: "p2" });
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(localStorage.removeItem).not.toHaveBeenCalled();
    });

    it("handles missing localStorage data gracefully", () => {
      expect(() => clearLastAgentIf({ projectId: "p1" })).not.toThrow();
    });

    it("handles malformed JSON gracefully", () => {
      store[LAST_AGENT_KEY] = "bad-json";
      expect(() => clearLastAgentIf({ projectId: "p1" })).not.toThrow();
    });
  });

  describe("getLastProject", () => {
    it("returns null when no data stored", () => {
      expect(getLastProject()).toBeNull();
    });

    it("returns the stored project id", () => {
      store[LAST_PROJECT_KEY] = "p1";
      expect(getLastProject()).toBe("p1");
    });
  });

  describe("setLastProject", () => {
    it("stores the project id in localStorage", () => {
      setLastProject("p1");
      expect(localStorage.setItem).toHaveBeenCalledWith(LAST_PROJECT_KEY, "p1");
    });

    it("overwrites the previous value", () => {
      store[LAST_PROJECT_KEY] = "p1";
      setLastProject("p2");
      expect(localStorage.setItem).toHaveBeenCalledWith(LAST_PROJECT_KEY, "p2");
    });
  });
});
