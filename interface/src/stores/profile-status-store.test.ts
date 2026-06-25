import { describe, it, expect, beforeEach, vi } from "vitest";

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
      streamingAgentInstanceIds: [] as string[],
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
import { ApiClientError } from "../shared/api/core";
import { EventType } from "../shared/types/aura-events";

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

    it("marks remote agents as error when polling fails", async () => {
      mockApi.swarm.getRemoteAgentState.mockRejectedValue(new Error("missing remote state"));

      useProfileStatusStore.getState().registerRemoteAgents([
        { agent_id: "r-error-1" },
      ]);

      await vi.waitFor(() => {
        expect(useProfileStatusStore.getState().statuses["r-error-1"]).toBe("error");
      });
    });

    it("unregisters a remote agent on 404 and stops polling it", async () => {
      const notFound = new ApiClientError(404, {
        error: "remote agent not found on swarm gateway",
        code: "not_found",
        details: null,
      });
      // Only r-404 gets 404 — other agents lingering in the module-level
      // poll set (from earlier tests) resolve so they don't accidentally
      // get unregistered and mask the assertion below.
      mockApi.swarm.getRemoteAgentState.mockImplementation((id: string) => {
        if (id === "r-404") return Promise.reject(notFound);
        return Promise.resolve({ state: "idle" });
      });

      useProfileStatusStore.getState().registerRemoteAgents([
        { agent_id: "r-404" },
      ]);

      await vi.waitFor(() => {
        expect(mockApi.swarm.getRemoteAgentState).toHaveBeenCalledWith("r-404");
      });

      await vi.waitFor(() => {
        expect(
          useProfileStatusStore.getState().machineTypes["r-404"],
        ).toBeUndefined();
        expect(
          useProfileStatusStore.getState().statuses["r-404"],
        ).toBeUndefined();
      });

      mockApi.swarm.getRemoteAgentState.mockClear();
      useProfileStatusStore.getState().registerRemoteAgents([
        { agent_id: "r-other" },
      ]);
      await vi.waitFor(() => {
        expect(mockApi.swarm.getRemoteAgentState).toHaveBeenCalledWith("r-other");
      });
      expect(
        mockApi.swarm.getRemoteAgentState.mock.calls.some(
          (args: unknown[]) => args[0] === "r-404",
        ),
      ).toBe(false);
    });

    it("pauses polling on a terminal `error` state but keeps the status", async () => {
      // Unlike a 404 (agent gone -> dropped), a terminal lifecycle state
      // means "dead until a user recovers it": stop polling but keep
      // showing `error`. This is the core of the fix for the 502/404 flood
      // on a failed remote agent.
      mockApi.swarm.getRemoteAgentState.mockImplementation((id: string) =>
        id === "r-term"
          ? Promise.resolve({ state: "error" })
          : Promise.resolve({ state: "idle" }),
      );

      useProfileStatusStore.getState().registerRemoteAgents([
        { agent_id: "r-term" },
      ]);

      await vi.waitFor(() => {
        expect(useProfileStatusStore.getState().statuses["r-term"]).toBe("error");
      });
      // Status + machineType are KEPT (contrast with the 404 case).
      expect(useProfileStatusStore.getState().machineTypes["r-term"]).toBe("remote");

      // No longer polled: a fresh register of another agent triggers a poll
      // over the active set, which must not include r-term.
      mockApi.swarm.getRemoteAgentState.mockClear();
      useProfileStatusStore.getState().registerRemoteAgents([
        { agent_id: "r-after-term" },
      ]);
      await vi.waitFor(() => {
        expect(mockApi.swarm.getRemoteAgentState).toHaveBeenCalledWith("r-after-term");
      });
      expect(
        mockApi.swarm.getRemoteAgentState.mock.calls.some(
          (args: unknown[]) => args[0] === "r-term",
        ),
      ).toBe(false);
    });

    it("pauses polling after consecutive failures but keeps the status", async () => {
      // The 502-flood fix for the app-wide poller: repeated transport/5xx
      // failures (here a stuck/unreachable agent) must stop polling after
      // MAX_CONSECUTIVE_POLL_FAILURES (3) rather than 502ing every 30s
      // forever. Each registerRemoteAgents() triggers a full poll cycle, so
      // registering further agents drives more consecutive failures without
      // relying on the 30s interval / fake timers.
      const callsFor = (id: string) =>
        mockApi.swarm.getRemoteAgentState.mock.calls.filter(
          (args: unknown[]) => args[0] === id,
        ).length;

      mockApi.swarm.getRemoteAgentState.mockImplementation((id: string) =>
        id === "r-fail"
          ? Promise.reject(new Error("502 Bad Gateway"))
          : Promise.resolve({ state: "idle" }),
      );

      const store = useProfileStatusStore.getState();
      // Drive several poll cycles — well past the 3-failure cap. The exact
      // poll on which the pause lands is timing-sensitive (the pause runs in
      // the rejection's `.catch` microtask), so we assert the count
      // *stabilizes* rather than an exact value.
      store.registerRemoteAgents([{ agent_id: "r-fail" }]);
      for (const id of ["r-fail-d1", "r-fail-d2", "r-fail-d3", "r-fail-d4"]) {
        store.registerRemoteAgents([{ agent_id: id }]);
        await vi.waitFor(() => expect(callsFor(id)).toBeGreaterThanOrEqual(1));
      }

      // r-fail has now hit the failure cap and been paused.
      const frozen = callsFor("r-fail");
      // MAX_CONSECUTIVE_POLL_FAILURES in the store is 3.
      expect(frozen).toBeGreaterThanOrEqual(3);
      // Status is KEPT as "error" (not deleted, unlike the 404 case).
      expect(useProfileStatusStore.getState().statuses["r-fail"]).toBe("error");

      // A further poll cycle must NOT poll r-fail again — its count is frozen.
      store.registerRemoteAgents([{ agent_id: "r-fail-d5" }]);
      await vi.waitFor(() => expect(callsFor("r-fail-d5")).toBeGreaterThanOrEqual(1));
      expect(callsFor("r-fail")).toBe(frozen);
    });

    it("re-arms polling when a paused agent reports a non-terminal state via WS", async () => {
      // Re-engagement: after we pause a terminal agent, a recovery that
      // moves it back to a live state (via the RemoteAgentStateChanged
      // push) must resume polling so its VM details refresh again.
      useProfileStatusStore.getState().init();

      mockApi.swarm.getRemoteAgentState.mockImplementation((id: string) =>
        id === "r-reeng"
          ? Promise.resolve({ state: "error" })
          : Promise.resolve({ state: "idle" }),
      );
      useProfileStatusStore.getState().registerRemoteAgents([
        { agent_id: "r-reeng" },
      ]);
      await vi.waitFor(() => {
        expect(useProfileStatusStore.getState().statuses["r-reeng"]).toBe("error");
      });

      // Recovery -> provisioning via WS push re-arms the poller.
      mockApi.swarm.getRemoteAgentState.mockClear();
      mockApi.swarm.getRemoteAgentState.mockResolvedValue({ state: "provisioning" });
      mockEventStore._fire(EventType.RemoteAgentStateChanged, {
        content: { agent_id: "r-reeng", state: "provisioning" },
      });

      // A subsequent poll cycle (triggered by registering another agent)
      // now includes the re-armed r-reeng.
      useProfileStatusStore.getState().registerRemoteAgents([
        { agent_id: "r-reeng-trigger" },
      ]);
      await vi.waitFor(() => {
        expect(mockApi.swarm.getRemoteAgentState).toHaveBeenCalledWith("r-reeng");
      });
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
