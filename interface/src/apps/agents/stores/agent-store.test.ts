import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Agent, SessionEvent } from "../../../types";
import type { DisplaySessionEvent } from "../../../types/stream";

const mockAgents: Agent[] = [
  {
    agent_id: "a1",
    user_id: "u1",
    name: "Bravo",
    role: "dev",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    agent_id: "a2",
    user_id: "u1",
    name: "Alpha",
    role: "dev",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
];

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    agents: {
      list: vi.fn(),
      listEvents: vi.fn(),
    },
  },
}));

vi.mock("../../../api/client", () => ({ api: mockApi }));

vi.mock("../../../utils/build-display-messages", () => ({
  buildDisplayEvents: (msgs: SessionEvent[]): DisplaySessionEvent[] =>
    msgs.map((m) => ({ id: m.event_id, role: m.role, text: m.content })) as unknown as DisplaySessionEvent[],
}));

import { useAgentStore } from "./agent-store";

beforeEach(() => {
  useAgentStore.setState({
    agents: [],
    agentsStatus: "idle",
    agentsError: null,
    history: {},
    selectedAgentId: null,
  });
  vi.clearAllMocks();
});

describe("agent-store", () => {
  describe("initial state", () => {
    it("has empty agents", () => {
      expect(useAgentStore.getState().agents).toEqual([]);
    });

    it("has idle status", () => {
      expect(useAgentStore.getState().agentsStatus).toBe("idle");
    });

    it("has no error", () => {
      expect(useAgentStore.getState().agentsError).toBeNull();
    });

    it("has empty history", () => {
      expect(useAgentStore.getState().history).toEqual({});
    });

    it("has no selectedAgentId", () => {
      expect(useAgentStore.getState().selectedAgentId).toBeNull();
    });
  });

  describe("fetchAgents", () => {
    it("loads and sorts agents by name", async () => {
      mockApi.agents.list.mockResolvedValue(mockAgents);

      await useAgentStore.getState().fetchAgents();

      const { agents, agentsStatus } = useAgentStore.getState();
      expect(agents).toHaveLength(2);
      expect(agents[0].name).toBe("Alpha");
      expect(agents[1].name).toBe("Bravo");
      expect(agentsStatus).toBe("ready");
    });

    it("sets error state on failure", async () => {
      mockApi.agents.list.mockRejectedValue(new Error("network error"));

      await useAgentStore.getState().fetchAgents();

      expect(useAgentStore.getState().agentsStatus).toBe("error");
      expect(useAgentStore.getState().agentsError).toBe("network error");
    });

    it("deduplicates concurrent calls", async () => {
      let resolveP: (v: Agent[]) => void;
      mockApi.agents.list.mockImplementation(
        () => new Promise((r) => { resolveP = r; }),
      );
      const p1 = useAgentStore.getState().fetchAgents();
      const p2 = useAgentStore.getState().fetchAgents();
      resolveP!(mockAgents);
      await Promise.all([p1, p2]);
      expect(mockApi.agents.list).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchHistory", () => {
    it("loads events for an agent", async () => {
      const msg: SessionEvent = {
        event_id: "m1",
        agent_instance_id: "ai1",
        project_id: "p1",
        role: "user",
        content: "Hello",
        created_at: "2025-06-01T00:00:00Z",
      };
      mockApi.agents.listEvents.mockResolvedValue([msg]);

      await useAgentStore.getState().fetchHistory("a1");

      const entry = useAgentStore.getState().history["a1"];
      expect(entry.status).toBe("ready");
      expect(entry.events).toHaveLength(1);
    });

    it("sets error on failure", async () => {
      mockApi.agents.listEvents.mockRejectedValue(new Error("fail"));

      await useAgentStore.getState().fetchHistory("a1");

      expect(useAgentStore.getState().history["a1"].status).toBe("error");
      expect(useAgentStore.getState().history["a1"].error).toBe("fail");
    });

    it("skips fetch when cache is fresh", async () => {
      mockApi.agents.listEvents.mockResolvedValue([]);
      await useAgentStore.getState().fetchHistory("a1");
      await useAgentStore.getState().fetchHistory("a1");
      expect(mockApi.agents.listEvents).toHaveBeenCalledTimes(1);
    });

    it("force re-fetches", async () => {
      mockApi.agents.listEvents.mockResolvedValue([]);
      await useAgentStore.getState().fetchHistory("a1");
      await useAgentStore.getState().fetchHistory("a1", { force: true });
      expect(mockApi.agents.listEvents).toHaveBeenCalledTimes(2);
    });

    it("deduplicates concurrent requests", async () => {
      let resolveP: (v: SessionEvent[]) => void;
      mockApi.agents.listEvents.mockImplementation(
        () => new Promise((r) => { resolveP = r; }),
      );
      const p1 = useAgentStore.getState().fetchHistory("a1");
      const p2 = useAgentStore.getState().fetchHistory("a1");
      resolveP!([]);
      await Promise.all([p1, p2]);
      expect(mockApi.agents.listEvents).toHaveBeenCalledTimes(1);
    });
  });

  describe("prefetchHistory", () => {
    it("calls fetchHistory without throwing", () => {
      mockApi.agents.listEvents.mockResolvedValue([]);
      expect(() => useAgentStore.getState().prefetchHistory("a1")).not.toThrow();
    });
  });

  describe("invalidateHistory", () => {
    it("removes the history entry for the agent", async () => {
      mockApi.agents.listEvents.mockResolvedValue([]);
      await useAgentStore.getState().fetchHistory("a1");
      expect(useAgentStore.getState().history["a1"]).toBeDefined();

      useAgentStore.getState().invalidateHistory("a1");
      expect(useAgentStore.getState().history["a1"]).toBeUndefined();
    });
  });

  describe("setSelectedAgent", () => {
    it("sets the selectedAgentId", () => {
      useAgentStore.getState().setSelectedAgent("a1");
      expect(useAgentStore.getState().selectedAgentId).toBe("a1");
    });

    it("can be cleared with null", () => {
      useAgentStore.getState().setSelectedAgent("a1");
      useAgentStore.getState().setSelectedAgent(null);
      expect(useAgentStore.getState().selectedAgentId).toBeNull();
    });
  });
});
