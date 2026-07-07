import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Agent, SessionEvent } from "../../../shared/types";
import { emptyAgentPermissions } from "../../../shared/types/permissions-wire";
import type { DisplaySessionEvent } from "../../../shared/types/stream";

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
    permissions: emptyAgentPermissions(),
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
    permissions: emptyAgentPermissions(),
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
    superAgent: {
      setup: vi.fn(),
      cleanup: vi.fn(),
    },
  },
}));

// Minimal hand-rolled zustand-shaped stores so tests can drive the exact
// auth/org settle timing the firstRunDetected state machine depends on
// (the real stores fire network calls from their own subscriptions).
type MockOrgState = {
  orgs: Array<{ org_id: string }>;
  activeOrg: { org_id: string } | null;
  orgsResolved: boolean;
};
type MockAuthState = { user: { user_id: string } | null };

const { orgStoreMock, authStoreMock } = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let state = initial;
    const listeners = new Set<(s: T) => void>();
    return {
      getState: (): T => state,
      setState: (partial: Partial<T>): void => {
        state = { ...state, ...partial };
        for (const listener of [...listeners]) listener(state);
      },
      subscribe: (listener: (s: T) => void): (() => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }
  return {
    orgStoreMock: makeStore({
      orgs: [] as Array<{ org_id: string }>,
      activeOrg: null as { org_id: string } | null,
      orgsResolved: false,
    }),
    authStoreMock: makeStore({ user: null as { user_id: string } | null }),
  };
});

vi.mock("../../../stores/org-store", () => ({ useOrgStore: orgStoreMock }));
vi.mock("../../../stores/auth-store", () => ({ useAuthStore: authStoreMock }));

vi.mock("../../../api/client", () => ({
  api: mockApi,
  STANDALONE_AGENT_HISTORY_LIMIT: 80,
}));

vi.mock("../../../utils/build-display-messages", () => ({
  buildDisplayEvents: (msgs: SessionEvent[]): DisplaySessionEvent[] =>
    msgs.map((m) => ({ id: m.event_id, role: m.role, text: m.content })) as unknown as DisplaySessionEvent[],
}));

import { useAgentStore } from "./agent-store";

beforeEach(() => {
  // Signing out resets the store AND the module-level per-session latches
  // (hasEnsuredCeoHomeThisSession / firstRunSignalSettledThisSession) via the
  // auth subscription; the explicit setState below is belt-and-braces.
  authStoreMock.setState({ user: null });
  orgStoreMock.setState({ orgs: [], activeOrg: null, orgsResolved: false });
  localStorage.clear();
  useAgentStore.setState({
    agents: [],
    agentsStatus: "idle",
    agentsError: null,
    firstRunDetected: false,
    history: {},
    selectedAgentId: null,
  });
  vi.clearAllMocks();
  mockApi.agents.list.mockReset();
  mockApi.superAgent.setup.mockReset();
  mockApi.superAgent.cleanup.mockReset();
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

describe("firstRunDetected state machine", () => {
  const ceoAgent: Agent = {
    ...mockAgents[0],
    agent_id: "ceo",
    name: "CEO",
  };

  function signIn(userId = "u1"): void {
    authStoreMock.setState({ user: { user_id: userId } });
  }

  function settleOrg(orgId: string | null): void {
    if (orgId) {
      orgStoreMock.setState({
        orgs: [{ org_id: orgId }],
        activeOrg: { org_id: orgId },
        orgsResolved: true,
      });
    } else {
      orgStoreMock.setState({ orgs: [], activeOrg: null, orgsResolved: true });
    }
  }

  it("new user: authoritative empty fetch sets firstRunDetected before creating the CEO", async () => {
    mockApi.agents.list.mockResolvedValue([]);
    mockApi.superAgent.setup.mockImplementation(async () => {
      // The first-run signal must already be latched when the CEO ensure runs.
      expect(useAgentStore.getState().firstRunDetected).toBe(true);
      return { agent: ceoAgent, created: true };
    });

    signIn();
    settleOrg("o1"); // org subscription triggers the forced, org-scoped fetch

    await vi.waitFor(() => {
      expect(useAgentStore.getState().firstRunDetected).toBe(true);
      expect(useAgentStore.getState().agents).toEqual([ceoAgent]);
    });
    expect(mockApi.agents.list).toHaveBeenCalledWith("o1");
    expect(mockApi.superAgent.setup).toHaveBeenCalledTimes(1);
  });

  it("pre-settle unscoped empty fetch neither sets firstRunDetected nor creates the CEO", async () => {
    mockApi.agents.list.mockResolvedValue([]);

    signIn();
    await useAgentStore.getState().fetchAgents();

    expect(useAgentStore.getState().firstRunDetected).toBe(false);
    expect(useAgentStore.getState().agentsStatus).toBe("ready");
    expect(mockApi.superAgent.setup).not.toHaveBeenCalled();
  });

  it("existing user with org-only agents: unscoped empty then org-scoped list, firstRun stays false", async () => {
    mockApi.agents.list.mockResolvedValueOnce([]); // unscoped, pre-settle
    signIn();
    await useAgentStore.getState().fetchAgents();
    expect(useAgentStore.getState().firstRunDetected).toBe(false);

    mockApi.agents.list.mockResolvedValueOnce(mockAgents); // org-scoped
    mockApi.superAgent.setup.mockResolvedValue({ agent: mockAgents[0], created: false });
    settleOrg("o1");

    await vi.waitFor(() => {
      expect(useAgentStore.getState().agents).toHaveLength(2);
    });
    expect(useAgentStore.getState().firstRunDetected).toBe(false);
    expect(mockApi.agents.list).toHaveBeenLastCalledWith("o1");
  });

  it("existing user with unscoped agents: firstRun stays false through org settle", async () => {
    mockApi.agents.list.mockResolvedValue(mockAgents);
    mockApi.superAgent.setup.mockResolvedValue({ agent: mockAgents[0], created: false });

    signIn();
    await useAgentStore.getState().fetchAgents();
    expect(useAgentStore.getState().firstRunDetected).toBe(false);

    settleOrg("o1");
    await vi.waitFor(() => {
      expect(mockApi.agents.list).toHaveBeenLastCalledWith("o1");
    });
    expect(useAgentStore.getState().firstRunDetected).toBe(false);
  });

  it("org settling mid-flight: the swallowed forced refetch is re-run by the drift check", async () => {
    let resolveUnscoped!: (agents: Agent[]) => void;
    mockApi.agents.list
      .mockImplementationOnce(() => new Promise<Agent[]>((r) => { resolveUnscoped = r; }))
      .mockResolvedValueOnce([]); // the org-scoped re-run
    mockApi.superAgent.setup.mockResolvedValue({ agent: ceoAgent, created: true });

    signIn();
    const inFlight = useAgentStore.getState().fetchAgents(); // unscoped, in flight
    settleOrg("o1"); // forced fetch fires here and is swallowed by the in-flight dedupe
    resolveUnscoped([]);
    await inFlight;

    await vi.waitFor(() => {
      expect(useAgentStore.getState().firstRunDetected).toBe(true);
      expect(useAgentStore.getState().agents).toEqual([ceoAgent]);
    });
    expect(mockApi.agents.list).toHaveBeenCalledTimes(2);
    expect(mockApi.agents.list).toHaveBeenLastCalledWith("o1");
  });

  it("user with zero orgs: roster resolving empty makes the unscoped fetch authoritative", async () => {
    mockApi.agents.list.mockResolvedValue([]);
    mockApi.superAgent.setup.mockResolvedValue({ agent: ceoAgent, created: true });

    signIn();
    await useAgentStore.getState().fetchAgents(); // roster not resolved yet
    expect(useAgentStore.getState().firstRunDetected).toBe(false);
    expect(mockApi.superAgent.setup).not.toHaveBeenCalled();

    settleOrg(null); // refreshOrgs succeeded: user genuinely has no org

    await vi.waitFor(() => {
      expect(useAgentStore.getState().firstRunDetected).toBe(true);
      expect(useAgentStore.getState().agents).toEqual([ceoAgent]);
    });
  });

  it("switching to an empty org mid-session does not re-trigger firstRun", async () => {
    mockApi.agents.list.mockResolvedValueOnce(mockAgents);
    mockApi.superAgent.setup.mockResolvedValue({ agent: mockAgents[0], created: false });

    signIn();
    settleOrg("o1");
    await vi.waitFor(() => {
      expect(useAgentStore.getState().agents).toHaveLength(2);
    });

    mockApi.agents.list.mockResolvedValueOnce([]);
    orgStoreMock.setState({
      orgs: [{ org_id: "o1" }, { org_id: "o2" }],
      activeOrg: { org_id: "o2" },
      orgsResolved: true,
    });

    await vi.waitFor(() => {
      expect(useAgentStore.getState().agents).toHaveLength(0);
    });
    expect(useAgentStore.getState().firstRunDetected).toBe(false);
  });

  it("account switch without logout resets firstRunDetected and the agent list", async () => {
    mockApi.agents.list.mockResolvedValue([]);
    mockApi.superAgent.setup.mockResolvedValue({ agent: ceoAgent, created: true });

    signIn("u1");
    settleOrg("o1");
    await vi.waitFor(() => {
      expect(useAgentStore.getState().firstRunDetected).toBe(true);
    });

    signIn("u2");

    expect(useAgentStore.getState().firstRunDetected).toBe(false);
    expect(useAgentStore.getState().agents).toEqual([]);
    expect(useAgentStore.getState().agentsStatus).toBe("idle");
  });
});
