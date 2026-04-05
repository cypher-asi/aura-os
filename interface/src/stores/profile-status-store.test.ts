import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const { mockEventStore, mockAuthStore, mockSidekickStore, mockApi } = vi.hoisted(() => {
  const subscribers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mockEventStore = {
    getState: vi.fn(() => ({
      connected: false,
      subscribe: (eventType: string, cb: (...args: unknown[]) => void) => {
        if (!subscribers[eventType]) subscribers[eventType] = [];
        subscribers[eventType].push(cb);
      },
    })),
    subscribe: vi.fn(() => () => {}),
    _fire: (eventType: string, event: unknown) => {
      for (const cb of subscribers[eventType] ?? []) cb(event);
    },
    _clearSubs: () => {
      for (const k of Object.keys(subscribers)) delete subscribers[k];
    },
  };

  const mockAuthStore = {
    getState: vi.fn(() => ({ user: null })),
    subscribe: vi.fn(() => () => {}),
  };

  const mockSidekickStore = {
    getState: vi.fn(() => ({
      streamingAgentInstanceId: null,
      onAgentInstanceUpdate: vi.fn(() => () => {}),
    })),
    subscribe: vi.fn(() => () => {}),
  };

  const mockApi = {
    swarm: {
      getRemoteAgentState: vi.fn(),
    },
  };

  return { mockEventStore, mockAuthStore, mockSidekickStore, mockApi };
});

vi.mock("./event-store", () => ({
  useEventStore: mockEventStore,
}));

vi.mock("./auth-store", () => ({
  useAuthStore: mockAuthStore,
}));

vi.mock("./sidekick-store", () => ({
  useSidekickStore: mockSidekickStore,
}));

vi.mock("../api/client", () => ({
  api: mockApi,
}));

import { useProfileStatusStore } from "./profile-status-store";

beforeEach(() => {
  useProfileStatusStore.setState({ statuses: {}, machineTypes: {} });
  vi.clearAllMocks();
  mockEventStore._clearSubs();
});

describe("profile-status-store", () => {
  describe("initial state", () => {
    it("starts with empty statuses", () => {
      expect(useProfileStatusStore.getState().statuses).toEqual({});
    });

    it("starts with empty machineTypes", () => {
      expect(useProfileStatusStore.getState().machineTypes).toEqual({});
    });
  });

  describe("registerAgents", () => {
    it("sets machine types for agents", () => {
      useProfileStatusStore.getState().registerAgents([
        { id: "a1", machineType: "local" },
        { id: "a2", machineType: "remote" },
      ]);
      const mt = useProfileStatusStore.getState().machineTypes;
      expect(mt["a1"]).toBe("local");
      expect(mt["a2"]).toBe("remote");
    });

    it("normalizes unknown machine types to local", () => {
      useProfileStatusStore.getState().registerAgents([
        { id: "a1", machineType: "weird" },
      ]);
      expect(useProfileStatusStore.getState().machineTypes["a1"]).toBe("local");
    });
  });

  describe("registerRemoteAgents", () => {
    it("sets machine type to remote", () => {
      mockApi.swarm.getRemoteAgentState.mockResolvedValue({ state: "idle" });
      useProfileStatusStore.getState().registerRemoteAgents([
        { agent_id: "r-mt-1" },
      ]);
      expect(useProfileStatusStore.getState().machineTypes["r-mt-1"]).toBe("remote");
    });

    it("polls remote agent state", () => {
      mockApi.swarm.getRemoteAgentState.mockResolvedValue({ state: "running" });
      useProfileStatusStore.getState().registerRemoteAgents([
        { agent_id: "r-poll-1" },
      ]);
      expect(mockApi.swarm.getRemoteAgentState).toHaveBeenCalledWith("r-poll-1");
    });
  });

  describe("status updates via setState", () => {
    it("can set a status directly", () => {
      useProfileStatusStore.setState((s) => ({
        statuses: { ...s.statuses, "a1": "online" },
      }));
      expect(useProfileStatusStore.getState().statuses["a1"]).toBe("online");
    });
  });
});
