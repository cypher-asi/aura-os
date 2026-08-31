import { act, renderHook } from "@testing-library/react";
import type { Session } from "../shared/types";
import type { AnnotatedSession } from "../components/SessionsList";
import {
  agentSessionsSurfaceKey,
  buildOptimisticSession,
  findMostRecentRealSessionForInstance,
  isOptimisticSessionId,
  OPTIMISTIC_SESSION_ID_PREFIX,
  projectSessionsSurfaceKey,
  useAgentBindingsKey,
  useAgentBindingsLoadStatus,
  useMostRecentSession,
  USER_SESSIONS_SURFACE_KEY,
  useSessionsForSurface,
  useSessionsListStore,
} from "./sessions-list-store";
import { useProjectsListStore } from "./projects-list-store";

const listProjectSessions = vi.fn();
const listSessions = vi.fn();
const listProjectBindings = vi.fn();
const listMySessions = vi.fn();
const fetchAgents = vi.fn();
// Module-level so the `useAgentStore` mock can read the latest value
// each time the loader's lazy import hits `.getState().agents`.
let mockAgentsState: Array<{ agent_id: string }> = [];

// `ApiClientError` (class) must round-trip through the real module so
// `instanceof ApiClientError` checks inside `loadUserSessions` match
// the instances the tests throw. `vi.importActual` preserves the
// real class while letting us swap out `api` for spy functions.
vi.mock("../api/client", async () => {
  const actual =
    await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    api: {
      listProjectSessions: (...args: unknown[]) => listProjectSessions(...args),
      listSessions: (...args: unknown[]) => listSessions(...args),
      agents: {
        listProjectBindings: (...args: unknown[]) =>
          listProjectBindings(...args),
      },
    },
  };
});

vi.mock("../shared/api/agents", async () => {
  const actual =
    await vi.importActual<typeof import("../shared/api/agents")>(
      "../shared/api/agents",
    );
  return {
    ...actual,
    sessionsApi: {
      ...actual.sessionsApi,
      listMySessions: (...args: unknown[]) => listMySessions(...args),
    },
  };
});

// `useAgentStore` is dynamically imported by the legacy fan-out path
// in `loadUserSessions`. The fan-out only needs `getState().agents`
// and `getState().fetchAgents()` so we stub a minimal Zustand-shaped
// `getState`. Static-importing the real store here would pull
// `useAuthStore` onto the boot path and re-introduce the TDZ cycle
// the dynamic import is there to avoid.
vi.mock("../apps/agents/stores/agent-store", () => ({
  useAgentStore: {
    getState: () => ({
      agents: mockAgentsState,
      fetchAgents: (...args: unknown[]) => fetchAgents(...args),
    }),
  },
}));

function makeSession(id: string, startedAt: string, agentInstanceId: string, projectId: string): Session {
  return {
    session_id: id,
    agent_instance_id: agentInstanceId,
    project_id: projectId,
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "",
    status: "completed",
    started_at: startedAt,
    ended_at: null,
  } as Session;
}

function resetStores() {
  useSessionsListStore.setState({
    sessionsBySurface: {},
    loadingBySurface: {},
    bindingsByAgent: {},
    bindingsLoadStatusByAgent: {},
    pendingSummariesById: {},
    version: 0,
  });
  useProjectsListStore.setState({
    projects: [],
    agentsByProject: {},
  });
}

describe("sessions-list-store", () => {
  beforeEach(() => {
    listProjectSessions.mockReset();
    listSessions.mockReset();
    listProjectBindings.mockReset();
    listMySessions.mockReset();
    fetchAgents.mockReset();
    fetchAgents.mockResolvedValue(undefined);
    mockAgentsState = [];
    resetStores();
  });

  describe("useAgentBindingsKey", () => {
    it("returns a stable string fingerprint of an agent's bindings once loaded", () => {
      useSessionsListStore.setState({
        bindingsByAgent: {
          "agent-x": [
            { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
            { project_agent_id: "i2a", project_id: "p2", project_name: "P2" },
          ],
        },
        bindingsLoadStatusByAgent: { "agent-x": "loaded" },
      });

      const { result, rerender } = renderHook(() =>
        useAgentBindingsKey("agent-x"),
      );

      const first = result.current;
      expect(first).toBe("p1:i1,p2:i2a");

      // The buggy selector this replaces returned a fresh object array
      // every render, defeating useShallow and triggering an infinite
      // loop. Stable string fingerprints can't drift on identity.
      rerender();
      rerender();
      expect(result.current).toBe(first);
    });

    it("returns an empty string when the agent has no bindings (server fetched empty)", () => {
      useSessionsListStore.setState({
        bindingsByAgent: { "agent-x": [] },
        bindingsLoadStatusByAgent: { "agent-x": "loaded" },
      });

      const { result } = renderHook(() => useAgentBindingsKey("agent-x"));
      expect(result.current).toBe("");
    });

    it("returns an empty string before bindings have been fetched (idle)", () => {
      const { result } = renderHook(() => useAgentBindingsKey("agent-x"));
      expect(result.current).toBe("");
    });
  });

  describe("useAgentBindingsLoadStatus", () => {
    it("starts at idle and reflects the agent-keyed status", () => {
      const { result, rerender } = renderHook(() =>
        useAgentBindingsLoadStatus("agent-x"),
      );
      expect(result.current).toBe("idle");

      act(() => {
        useSessionsListStore.setState({
          bindingsLoadStatusByAgent: { "agent-x": "loading" },
        });
      });
      rerender();
      expect(result.current).toBe("loading");

      act(() => {
        useSessionsListStore.setState({
          bindingsLoadStatusByAgent: { "agent-x": "loaded" },
        });
      });
      rerender();
      expect(result.current).toBe("loaded");
    });
  });

  describe("useSessionsForSurface", () => {
    it("returns the same empty-array reference when the surface is missing", () => {
      const { result, rerender } = renderHook(() =>
        useSessionsForSurface("project:none"),
      );
      const first = result.current;
      expect(first).toEqual([]);
      rerender();
      expect(result.current).toBe(first);
    });

    it("returns store-owned arrays with stable identity across renders", async () => {
      listProjectSessions.mockResolvedValue([
        makeSession("s1", "2026-04-16T00:00:00Z", "i1", "p1"),
      ]);

      const { result, rerender } = renderHook(() =>
        useSessionsForSurface(projectSessionsSurfaceKey("p1")),
      );

      await act(async () => {
        await useSessionsListStore
          .getState()
          .loadProjectSessions("p1", "Project One");
      });

      const first = result.current;
      expect(first).toHaveLength(1);
      rerender();
      expect(result.current).toBe(first);
    });
  });

  describe("loadAgentSessions", () => {
    it("fetches authoritative bindings from the server and fans out per binding", async () => {
      // Crucially: nothing in `useProjectsListStore`. The fix is that
      // `loadAgentSessions` must NOT depend on the active-org-scoped
      // client snapshot — it must call the server-authoritative
      // `listProjectBindings` endpoint.
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
        { project_agent_id: "i2", project_id: "p2", project_name: "P2" },
      ]);
      listSessions.mockImplementation(
        (projectId: string, projectAgentId: string) =>
          Promise.resolve([
            makeSession(
              `${projectId}-${projectAgentId}`,
              "2026-04-16T00:00:00Z",
              projectAgentId,
              projectId,
            ),
          ]),
      );

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      expect(listProjectBindings).toHaveBeenCalledTimes(1);
      expect(listProjectBindings).toHaveBeenCalledWith("agent-x");
      expect(listSessions).toHaveBeenCalledTimes(2);
      expect(listSessions).toHaveBeenCalledWith("p1", "i1");
      expect(listSessions).toHaveBeenCalledWith("p2", "i2");

      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const sessions =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(sessions).toHaveLength(2);
      expect(sessions?.map((s) => s._projectId).sort()).toEqual(["p1", "p2"]);
      expect(sessions?.map((s) => s._projectName).sort()).toEqual(["P1", "P2"]);

      const status =
        useSessionsListStore.getState().bindingsLoadStatusByAgent["agent-x"];
      expect(status).toBe("loaded");
    });

    it("regression: surfaces sessions for an agent whose only binding is invisible to useProjectsListStore (Glenn / Machina)", async () => {
      // Reproduces the bug: an older remote agent auto-bound to a Home
      // project that lives outside the active-org sidebar. The active
      // org's projects list has no entry for the agent at all.
      useProjectsListStore.setState({
        projects: [{ project_id: "visible-project", name: "Visible" } as never],
        agentsByProject: {
          "visible-project": [
            { agent_instance_id: "iv", agent_id: "some-other-agent" } as never,
          ],
        },
      });
      listProjectBindings.mockResolvedValue([
        {
          project_agent_id: "pa-home",
          project_id: "p-home-other-org",
          project_name: "Home",
        },
      ]);
      listSessions.mockResolvedValue([
        makeSession("home-session", "2026-04-16T00:00:00Z", "pa-home", "p-home-other-org"),
      ]);

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("glenn");
      });

      const sessions =
        useSessionsListStore.getState().sessionsBySurface[
          agentSessionsSurfaceKey("glenn")
        ];
      expect(sessions).toHaveLength(1);
      expect(sessions?.[0].session_id).toBe("home-session");
      expect(sessions?.[0]._projectId).toBe("p-home-other-org");
      expect(sessions?.[0]._projectName).toBe("Home");
    });

    it("stores sessions sorted by started_at desc so [0] is the most recent", async () => {
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);
      listSessions.mockResolvedValue([
        makeSession("older", "2026-04-16T00:00:00Z", "i1", "p1"),
        makeSession("newer", "2026-04-16T05:00:00Z", "i1", "p1"),
      ]);

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      const { result } = renderHook(() =>
        useMostRecentSession(agentSessionsSurfaceKey("agent-x")),
      );
      expect(result.current?.session_id).toBe("newer");
    });

    it("useMostRecentSession skips optimistic placeholder rows", () => {
      // A leaked optimistic row (panel unmounted mid-stream before
      // SessionReady could swap) sorted to the top by `started_at` —
      // without this filter, default-session redirects would prime
      // `?session=optimistic:...` and 400 the next history fetch.
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const real = {
        ...makeSession("real-1", "2026-04-16T00:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      } as AnnotatedSession;
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}leak`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
        startedAt: "2026-04-16T05:00:00Z",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimistic, real] },
      });

      const { result } = renderHook(() =>
        useMostRecentSession(surfaceKey),
      );
      expect(result.current?.session_id).toBe("real-1");
    });

    it("findMostRecentRealSessionForInstance skips optimistic placeholder rows", () => {
      const otherInstance = {
        ...makeSession("other-agent", "2026-04-16T09:00:00Z", "i2", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i2",
      } as AnnotatedSession;
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}leak`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
        startedAt: "2026-04-16T08:00:00Z",
      });
      const real = {
        ...makeSession("real-1", "2026-04-16T00:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      } as AnnotatedSession;

      expect(
        findMostRecentRealSessionForInstance(
          [otherInstance, optimistic, real],
          "i1",
        )?.session_id,
      ).toBe("real-1");
    });

    it("marks the bindings status as 'error' when listProjectBindings fails and skips the session fan-out", async () => {
      listProjectBindings.mockRejectedValue(new Error("boom"));
      const consoleErr = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      expect(listSessions).not.toHaveBeenCalled();
      const status =
        useSessionsListStore.getState().bindingsLoadStatusByAgent["agent-x"];
      expect(status).toBe("error");
      consoleErr.mockRestore();
    });

    it("ignores out-of-order responses via per-surface request ids", async () => {
      // The loader has two checkpoints: after listProjectBindings, and
      // after the per-binding listSessions fan-out. This test exercises
      // the second one — call 1 holds at listSessions, call 2 finishes,
      // then call 1's stale listSessions result is dropped.
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);

      let resolveFirst!: (sessions: Session[]) => void;
      const firstFetch = new Promise<Session[]>((resolve) => {
        resolveFirst = resolve;
      });
      listSessions.mockReturnValueOnce(firstFetch);
      listSessions.mockResolvedValueOnce([
        makeSession("v2", "2026-04-16T02:00:00Z", "i1", "p1"),
      ]);

      const { loadAgentSessions } = useSessionsListStore.getState();
      const firstPromise = loadAgentSessions("agent-x");

      // Drain microtasks so call 1 clears its listProjectBindings await
      // and reaches the listSessions await BEFORE call 2 starts and
      // bumps the request id. Without this, call 1's bindings-checkpoint
      // request-id check would short-circuit it before listSessions is
      // ever invoked, defeating the second-checkpoint test.
      await Promise.resolve();
      await Promise.resolve();

      const secondPromise = loadAgentSessions("agent-x");

      resolveFirst([
        makeSession("v1", "2026-04-16T01:00:00Z", "i1", "p1"),
      ]);
      await act(async () => {
        await Promise.all([firstPromise, secondPromise]);
      });

      const sessions =
        useSessionsListStore.getState().sessionsBySurface[
          agentSessionsSurfaceKey("agent-x")
        ];
      expect(sessions?.map((s) => s.session_id)).toEqual(["v2"]);
    });
  });

  describe("loadUserSessions", () => {
    it("fast path: annotates rows from /api/me/sessions with cached project names", async () => {
      useProjectsListStore.setState({
        projects: [
          { project_id: "p1", name: "Project One" } as never,
          { project_id: "p2", name: "Project Two" } as never,
        ],
        agentsByProject: {},
      });
      listMySessions.mockResolvedValue([
        {
          ...makeSession("s-newer", "2026-04-16T05:00:00Z", "i1", "p1"),
          agent_id: "agent-a",
        },
        {
          ...makeSession("s-older", "2026-04-16T01:00:00Z", "i2", "p2"),
          agent_id: "agent-b",
        },
      ]);

      await act(async () => {
        await useSessionsListStore.getState().loadUserSessions();
      });

      // Fast path means NO legacy fan-out. If we accidentally tripped
      // the fallback we'd see listProjectBindings + listSessions
      // calls fan out per agent; assert they were never invoked.
      expect(listMySessions).toHaveBeenCalledTimes(1);
      expect(listProjectBindings).not.toHaveBeenCalled();
      expect(listSessions).not.toHaveBeenCalled();

      const rows =
        useSessionsListStore.getState().sessionsBySurface[
          USER_SESSIONS_SURFACE_KEY
        ];
      expect(rows?.map((r) => r.session_id)).toEqual(["s-newer", "s-older"]);
      expect(rows?.[0]._projectName).toBe("Project One");
      expect(rows?.[0]._agentId).toBe("agent-a");
      expect(rows?.[1]._projectName).toBe("Project Two");
      expect(rows?.[1]._agentId).toBe("agent-b");
    });

    it("does not poison the chat surface when /api/me/sessions returns a malformed non-array", async () => {
      listMySessions.mockResolvedValue({ sessions: null } as never);
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await act(async () => {
        await useSessionsListStore.getState().loadUserSessions();
      });

      expect(listMySessions).toHaveBeenCalledTimes(1);
      expect(listProjectBindings).not.toHaveBeenCalled();
      expect(listSessions).not.toHaveBeenCalled();
      expect(
        useSessionsListStore.getState().sessionsBySurface[
          USER_SESSIONS_SURFACE_KEY
        ],
      ).toEqual([]);
      expect(consoleWarn).toHaveBeenCalledWith(
        "GET /api/me/sessions returned a non-array session list; ignoring",
        { receivedType: "object" },
      );
      consoleWarn.mockRestore();
    });

    it("ignores malformed session rows from /api/me/sessions instead of crashing renderers", async () => {
      listMySessions.mockResolvedValue({
        sessions: [
          {
            ...makeSession("s-good", "2026-04-16T05:00:00Z", "i1", "p1"),
            agent_id: "agent-a",
          },
          { session_id: "s-bad" },
        ],
      } as never);
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await act(async () => {
        await useSessionsListStore.getState().loadUserSessions();
      });

      const rows =
        useSessionsListStore.getState().sessionsBySurface[
          USER_SESSIONS_SURFACE_KEY
        ];
      expect(rows?.map((r) => r.session_id)).toEqual(["s-good"]);
      expect(consoleWarn).toHaveBeenCalledWith(
        "GET /api/me/sessions returned malformed session rows; ignoring invalid rows",
        { received: 2, accepted: 1 },
      );
      consoleWarn.mockRestore();
    });

    it("falls back to per-agent fan-out when /api/me/sessions returns 404 (storage migration not yet live)", async () => {
      // Reproduces the post-19f5203ad / pre-aura-storage-deploy window
      // where `/api/me/sessions` 404s. Without the FE fallback the
      // chat-app left panel goes empty and the only signal is a
      // `Failed to load user sessions` console.error -- same break
      // mode the project sessions surface had before commit fb9a45...
      const { ApiClientError } = await vi.importActual<
        typeof import("../api/client")
      >("../api/client");
      listMySessions.mockRejectedValue(
        new ApiClientError(404, {
          error: "not found",
          code: "storage_error",
          details: null,
        }),
      );

      mockAgentsState = [
        { agent_id: "agent-a" },
        { agent_id: "agent-b" },
      ];

      listProjectBindings.mockImplementation(async (agentId: string) => {
        if (agentId === "agent-a") {
          return [
            { project_agent_id: "ia1", project_id: "p1", project_name: "P1" },
          ];
        }
        return [
          { project_agent_id: "ib1", project_id: "p-home", project_name: "Home" },
        ];
      });
      listSessions.mockImplementation(
        async (projectId: string, projectAgentId: string) => [
          makeSession(
            `${projectId}-${projectAgentId}`,
            "2026-04-16T00:00:00Z",
            projectAgentId,
            projectId,
          ),
        ],
      );

      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

      await act(async () => {
        await useSessionsListStore.getState().loadUserSessions();
      });

      // The fast path was tried once, then the fallback fanned out
      // per agent. fetchAgents is called to prime the lazy-imported
      // agent store before we read its `.agents` snapshot.
      expect(listMySessions).toHaveBeenCalledTimes(1);
      expect(fetchAgents).toHaveBeenCalledTimes(1);
      expect(listProjectBindings).toHaveBeenCalledWith("agent-a");
      expect(listProjectBindings).toHaveBeenCalledWith("agent-b");
      expect(listSessions).toHaveBeenCalledWith("p1", "ia1");
      expect(listSessions).toHaveBeenCalledWith("p-home", "ib1");

      const rows =
        useSessionsListStore.getState().sessionsBySurface[
          USER_SESSIONS_SURFACE_KEY
        ];
      expect(rows?.map((r) => r.session_id).sort()).toEqual([
        "p-home-ib1",
        "p1-ia1",
      ]);
      // Project name comes straight from the binding, not the
      // projects-list-store cache -- the "Home" project deliberately
      // isn't seeded in `useProjectsListStore` here to prove this.
      const home = rows?.find((r) => r._projectId === "p-home");
      expect(home?._projectName).toBe("Home");
      expect(home?._agentId).toBe("agent-b");
      expect(home?._agentInstanceId).toBe("ib1");

      // 404 is the *expected* trigger for the fallback; the loader
      // must NOT escalate it to the `Failed to load user sessions`
      // console.error path (the catch at the bottom of the loader).
      expect(consoleErr).not.toHaveBeenCalledWith(
        "Failed to load user sessions",
        expect.anything(),
      );
      consoleErr.mockRestore();
    });

    it("bubbles non-404 errors instead of silently masking them as an empty list", async () => {
      const { ApiClientError } = await vi.importActual<
        typeof import("../api/client")
      >("../api/client");
      listMySessions.mockRejectedValue(
        new ApiClientError(500, {
          error: "boom",
          code: "storage_error",
          details: null,
        }),
      );
      const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

      await act(async () => {
        await useSessionsListStore.getState().loadUserSessions();
      });

      // 5xx errors must NOT trip the fallback -- a real outage should
      // surface as the documented `Failed to load user sessions`
      // console.error, not silently degrade to a per-agent fan-out
      // that masks the upstream failure.
      expect(fetchAgents).not.toHaveBeenCalled();
      expect(listProjectBindings).not.toHaveBeenCalled();
      expect(consoleErr).toHaveBeenCalledWith(
        "Failed to load user sessions",
        expect.any(ApiClientError),
      );
      consoleErr.mockRestore();
    });

    it("falls-back-empty when the user has no agents (legacy fan-out has nothing to walk)", async () => {
      const { ApiClientError } = await vi.importActual<
        typeof import("../api/client")
      >("../api/client");
      listMySessions.mockRejectedValue(
        new ApiClientError(404, {
          error: "not found",
          code: "storage_error",
          details: null,
        }),
      );
      mockAgentsState = [];

      await act(async () => {
        await useSessionsListStore.getState().loadUserSessions();
      });

      // No agents to fan out across -- the loader still flips the
      // loading flag off and writes an empty row list rather than
      // leaving the surface stuck in `loading:true`.
      expect(listProjectBindings).not.toHaveBeenCalled();
      expect(listSessions).not.toHaveBeenCalled();
      const rows =
        useSessionsListStore.getState().sessionsBySurface[
          USER_SESSIONS_SURFACE_KEY
        ];
      expect(rows ?? []).toEqual([]);
      expect(
        useSessionsListStore.getState().loadingBySurface[
          USER_SESSIONS_SURFACE_KEY
        ],
      ).toBe(false);
    });
  });

  describe("addOptimisticSession / replaceSessionId", () => {
    function annotate(session: Session): AnnotatedSession {
      return {
        ...session,
        _projectId: session.project_id,
        _projectName: "P1",
        _agentInstanceId: session.agent_instance_id,
      };
    }

    it("inserts the optimistic row at the top of the surface for the just-pressed +", () => {
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const existing = annotate(
        makeSession("s1", "2026-04-16T00:00:00Z", "i1", "p1"),
      );
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [existing] },
      });
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });

      act(() => {
        useSessionsListStore
          .getState()
          .addOptimisticSession(surfaceKey, optimistic);
      });

      const ids = useSessionsListStore
        .getState()
        .sessionsBySurface[surfaceKey]?.map((s) => s.session_id);
      expect(ids?.[0]).toBe(optimistic.session_id);
      expect(ids).toContain("s1");
      expect(isOptimisticSessionId(optimistic.session_id)).toBe(true);
    });

    it("dedupes when the same optimistic id is added twice", () => {
      const surfaceKey = projectSessionsSurfaceKey("p1");
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });

      act(() => {
        const store = useSessionsListStore.getState();
        store.addOptimisticSession(surfaceKey, optimistic);
        store.addOptimisticSession(surfaceKey, optimistic);
      });

      expect(
        useSessionsListStore.getState().sessionsBySurface[surfaceKey],
      ).toHaveLength(1);
    });

    it("replaceSessionId rewrites the row in place when SessionReady arrives", () => {
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const existing = annotate(
        makeSession("s1", "2026-04-16T01:00:00Z", "i1", "p1"),
      );
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimistic, existing] },
      });

      act(() => {
        useSessionsListStore
          .getState()
          .replaceSessionId(surfaceKey, optimistic.session_id, "real-session");
      });

      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(rows?.map((s) => s.session_id)).toEqual([
        "real-session",
        "s1",
      ]);
    });

    it("replaceSessionId drops the optimistic row when the real id already exists", () => {
      // Race: a parallel `loadAgentSessions` brings the real session
      // back before `SessionReady` lands. We must not produce two rows
      // for the same session.
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const real = annotate(
        makeSession("real-session", "2026-04-16T01:00:00Z", "i1", "p1"),
      );
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimistic, real] },
      });

      act(() => {
        useSessionsListStore
          .getState()
          .replaceSessionId(surfaceKey, optimistic.session_id, "real-session");
      });

      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(rows?.map((s) => s.session_id)).toEqual(["real-session"]);
    });

    it("preserves optimistic rows across an in-flight loadAgentSessions refetch", async () => {
      // The bumpVersion that fires alongside SessionReady triggers a
      // fresh fan-out; the just-created session may still be filtered
      // out by the server's `filter_nonempty_sessions`. The store
      // carries the optimistic row through so the sidekick doesn't
      // flicker empty.
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);
      listSessions.mockResolvedValue([
        makeSession("older", "2026-04-15T00:00:00Z", "i1", "p1"),
      ]);
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimistic] },
      });

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      const ids = useSessionsListStore
        .getState()
        .sessionsBySurface[surfaceKey]?.map((s) => s.session_id);
      expect(ids).toContain(optimistic.session_id);
      expect(ids).toContain("older");
    });

    it("replaces an optimistic row when the reload already contains the materialized session", async () => {
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);
      listSessions.mockResolvedValue([
        makeSession("real-session", "2026-04-16T00:00:01Z", "i1", "p1"),
        makeSession("older", "2026-04-15T00:00:00Z", "i1", "p1"),
      ]);
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}abc`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
        startedAt: "2026-04-16T00:00:00Z",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimistic] },
      });

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      const ids = useSessionsListStore
        .getState()
        .sessionsBySurface[surfaceKey]?.map((s) => s.session_id);
      expect(ids).toEqual(["real-session", "older"]);
    });

    // Regression for "New Chat vanishes after first send": once
    // `replaceSessionId` swaps `optimistic:abc → real-X`, a stale
    // list response that started before the swap may not include
    // `real-X` (server's `list_sessions` filters zero-event sessions
    // and the persistence write may still be in flight). The store
    // must carry the just-swapped real-id row across that reload so
    // the row stays put while the title generator catches up.
    it("preserves a recently-swapped real-id row across a stale loadAgentSessions response", async () => {
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);
      listSessions.mockResolvedValue([
        makeSession("older", "2026-04-15T00:00:00Z", "i1", "p1"),
      ]);
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const swapped: AnnotatedSession = {
        ...makeSession("real-X", new Date().toISOString(), "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      };
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [swapped] },
      });

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      const ids = useSessionsListStore
        .getState()
        .sessionsBySurface[surfaceKey]?.map((s) => s.session_id);
      expect(ids).toEqual(["real-X", "older"]);
    });

    it("drops a stale real-id row that the server no longer returns once the row's started_at is older than the newest server row", async () => {
      // Sanity: the real-id preservation only fires while the row is
      // still "newer than the newest server row", so an authoritative
      // server-side delete (or any server view that legitimately drops
      // the row) eventually wins out and the local state converges.
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);
      listSessions.mockResolvedValue([
        makeSession("newer-on-server", "2030-01-01T00:00:00Z", "i1", "p1"),
      ]);
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const stale: AnnotatedSession = {
        ...makeSession("stale-local", "2026-04-15T00:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      };
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [stale] },
      });

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      const ids = useSessionsListStore
        .getState()
        .sessionsBySurface[surfaceKey]?.map((s) => s.session_id);
      expect(ids).toEqual(["newer-on-server"]);
    });
  });

  describe("removeSession / restoreSession", () => {
    it("removeSession is a no-op when the surface or session is missing", () => {
      const { removeSession } = useSessionsListStore.getState();
      act(() => {
        removeSession("project:nope", "s-nope");
      });
      expect(useSessionsListStore.getState().sessionsBySurface).toEqual({});
    });

    it("restoreSession inserts and re-sorts; removeSession filters in place", () => {
      const surfaceKey = projectSessionsSurfaceKey("p1");
      const older = {
        ...makeSession("s1", "2026-04-16T00:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      };
      const newer = {
        ...makeSession("s2", "2026-04-16T05:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      };
      const { restoreSession, removeSession } = useSessionsListStore.getState();

      act(() => {
        restoreSession(surfaceKey, older);
        restoreSession(surfaceKey, newer);
      });
      expect(
        useSessionsListStore
          .getState()
          .sessionsBySurface[surfaceKey]?.map((s) => s.session_id),
      ).toEqual(["s2", "s1"]);

      act(() => {
        removeSession(surfaceKey, "s1");
      });
      expect(
        useSessionsListStore
          .getState()
          .sessionsBySurface[surfaceKey]?.map((s) => s.session_id),
      ).toEqual(["s2"]);
    });

    it("removeSession drops any cached pending summary so the entry doesn't leak", () => {
      const surfaceKey = projectSessionsSurfaceKey("p1");
      const session = {
        ...makeSession("s1", "2026-04-16T00:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      };
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [session] },
        pendingSummariesById: { s1: "Stale Title" },
      });

      act(() => {
        useSessionsListStore.getState().removeSession(surfaceKey, "s1");
      });

      expect(
        useSessionsListStore.getState().pendingSummariesById,
      ).toEqual({});
    });

    it("setSessionStatus patches every loaded surface that contains the session", () => {
      const session = {
        ...makeSession("s1", "2026-04-16T00:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      };
      const other = {
        ...makeSession("s2", "2026-04-15T00:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      };
      useSessionsListStore.setState({
        sessionsBySurface: {
          "project:p1": [session, other],
          "agent:a1": [session],
        },
      });

      act(() => {
        useSessionsListStore.getState().setSessionStatus("s1", "archived");
      });

      const surfaces = useSessionsListStore.getState().sessionsBySurface;
      expect(surfaces["project:p1"]?.[0].status).toBe("archived");
      expect(surfaces["agent:a1"]?.[0].status).toBe("archived");
      expect(surfaces["project:p1"]?.[1]).toBe(other);
    });
  });

  describe("setSessionSummary / pendingSummariesById", () => {
    function annotate(session: Session): AnnotatedSession {
      return {
        ...session,
        _projectId: session.project_id,
        _projectName: "P1",
        _agentInstanceId: session.agent_instance_id,
      };
    }

    it("does NOT touch unrelated optimistic rows when a different session's title arrives", () => {
      // Repro for the duplicate-row bug: while opt-B is the placeholder
      // for session B, a delayed Title-A event for session A used to
      // stamp opt-B with Title-A and survive `replaceSessionId`'s swap,
      // making real-B render with Title-A — a visual duplicate of
      // real-A. The fix is to scope `setSessionSummary` to its real id
      // and stash the pending title in `pendingSummariesById` instead.
      const surfaceKey = projectSessionsSurfaceKey("p1");
      const realA = annotate(
        makeSession("real-A", "2026-04-16T00:00:00Z", "i1", "p1"),
      );
      const optimisticB = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}b`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimisticB, realA] },
      });

      act(() => {
        useSessionsListStore
          .getState()
          .setSessionSummary("real-A", "Title-A");
      });

      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      const optimisticRow = rows?.find(
        (s) => s.session_id === optimisticB.session_id,
      );
      const realRow = rows?.find((s) => s.session_id === "real-A");
      expect(optimisticRow?.summary_of_previous_context).toBe("");
      expect(realRow?.summary_of_previous_context).toBe("Title-A");
    });

    it("caches the title when the row isn't in any surface yet (Haiku faster than SessionReady)", () => {
      act(() => {
        useSessionsListStore
          .getState()
          .setSessionSummary("real-A", "Title-A");
      });

      expect(
        useSessionsListStore.getState().pendingSummariesById["real-A"],
      ).toBe("Title-A");
    });

    it("bumps version when a title arrives before the row exists", () => {
      expect(useSessionsListStore.getState().version).toBe(0);

      act(() => {
        useSessionsListStore
          .getState()
          .setSessionSummary("real-A", "Title-A");
      });

      expect(useSessionsListStore.getState().version).toBe(1);
    });

    it("does not bump version when the matching row is already present", () => {
      const surfaceKey = projectSessionsSurfaceKey("p1");
      const real = {
        ...makeSession("real-A", "2026-04-16T00:00:00Z", "i1", "p1"),
        _projectId: "p1",
        _projectName: "P1",
        _agentInstanceId: "i1",
      } as AnnotatedSession;
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [real] },
        version: 4,
      });

      act(() => {
        useSessionsListStore
          .getState()
          .setSessionSummary("real-A", "Title-A");
      });

      expect(useSessionsListStore.getState().version).toBe(4);
    });

    it("replaceSessionId applies a cached pending summary and clears the entry", () => {
      // The title race: Haiku finished and emitted before SessionReady
      // delivered the real id to the client. The optimistic placeholder
      // therefore still has an empty summary, but `pendingSummariesById`
      // remembers the title against the real id. The swap should pick
      // it up so the new chat row renders with its title immediately.
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const optimistic = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}a`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [optimistic] },
        pendingSummariesById: { "real-A": "Title-A" },
      });

      act(() => {
        useSessionsListStore
          .getState()
          .replaceSessionId(surfaceKey, optimistic.session_id, "real-A");
      });

      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(rows).toHaveLength(1);
      expect(rows?.[0].session_id).toBe("real-A");
      expect(rows?.[0].summary_of_previous_context).toBe("Title-A");
      expect(
        useSessionsListStore.getState().pendingSummariesById,
      ).toEqual({});
    });

    it("loadProjectSessions applies a pending title to the materialized row when the load resolves AFTER the WS event", async () => {
      // The clobber race: SessionReady's bumpVersion kicked off
      // loadProjectSessions; the Haiku title arrived first and
      // setSessionSummary stashed it in pendingSummariesById. Without
      // this merge, the load's empty-summary row would overwrite the
      // patched title and the cache would never re-apply, leaving the
      // sidekick stuck on "New chat".
      listProjectSessions.mockResolvedValue([
        makeSession("real-A", "2026-04-16T00:00:00Z", "i1", "p1"),
      ]);
      useSessionsListStore.setState({
        pendingSummariesById: { "real-A": "Title-A" },
      });

      await act(async () => {
        await useSessionsListStore
          .getState()
          .loadProjectSessions("p1", "Project One");
      });

      const surfaceKey = projectSessionsSurfaceKey("p1");
      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(rows).toHaveLength(1);
      expect(rows?.[0].session_id).toBe("real-A");
      expect(rows?.[0].summary_of_previous_context).toBe("Title-A");
      expect(
        useSessionsListStore.getState().pendingSummariesById,
      ).toEqual({});
    });

    it("loadProjectSessions prefers the server's non-empty summary when both are present", async () => {
      const serverSession = makeSession(
        "real-A",
        "2026-04-16T00:00:00Z",
        "i1",
        "p1",
      );
      serverSession.summary_of_previous_context = "Server Title";
      listProjectSessions.mockResolvedValue([serverSession]);
      useSessionsListStore.setState({
        pendingSummariesById: { "real-A": "Cached Title" },
      });

      await act(async () => {
        await useSessionsListStore
          .getState()
          .loadProjectSessions("p1", "Project One");
      });

      const surfaceKey = projectSessionsSurfaceKey("p1");
      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(rows?.[0].summary_of_previous_context).toBe("Server Title");
      // The cached entry doesn't match the server's title so we must
      // keep it for any *other* surface that might still apply it
      // (loadAgentSessions for this same id, replaceSessionId during
      // an in-flight optimistic swap, etc.).
      expect(
        useSessionsListStore.getState().pendingSummariesById["real-A"],
      ).toBe("Cached Title");
    });

    it("loadAgentSessions also applies pending titles to the materialized list", async () => {
      listProjectBindings.mockResolvedValue([
        { project_agent_id: "i1", project_id: "p1", project_name: "P1" },
      ]);
      listSessions.mockResolvedValue([
        makeSession("real-A", "2026-04-16T00:00:00Z", "i1", "p1"),
      ]);
      useSessionsListStore.setState({
        pendingSummariesById: { "real-A": "Title-A" },
      });

      await act(async () => {
        await useSessionsListStore.getState().loadAgentSessions("agent-x");
      });

      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      expect(rows?.[0].summary_of_previous_context).toBe("Title-A");
      expect(
        useSessionsListStore.getState().pendingSummariesById,
      ).toEqual({});
    });

    it("regression: rapid + chat creates with delayed titles do not produce a duplicate-titled row", () => {
      // Walks the full sequence the bug report describes:
      //   1. send #1, SessionReady-1 swaps opt-1 -> real-1.
      //   2. user clicks +, send #2 -> opt-2 inserted alongside real-1.
      //   3. Title-1 arrives late.
      //   4. SessionReady-2 swaps opt-2 -> real-2.
      //   5. Title-2 arrives.
      // Before the fix step 3 also stamped opt-2 with Title-1, causing
      // the post-swap row at step 4 to duplicate real-1's title.
      const surfaceKey = agentSessionsSurfaceKey("agent-x");
      const opt1 = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}1`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
        startedAt: "2026-04-16T01:00:00Z",
      });
      useSessionsListStore.setState({
        sessionsBySurface: { [surfaceKey]: [opt1] },
      });

      const store = useSessionsListStore.getState();
      act(() => {
        store.replaceSessionId(surfaceKey, opt1.session_id, "real-1");
      });

      const opt2 = buildOptimisticSession({
        optimisticId: `${OPTIMISTIC_SESSION_ID_PREFIX}2`,
        projectId: "p1",
        projectName: "P1",
        agentInstanceId: "i1",
        startedAt: "2026-04-16T02:00:00Z",
      });
      act(() => {
        useSessionsListStore.getState().addOptimisticSession(surfaceKey, opt2);
      });

      act(() => {
        useSessionsListStore
          .getState()
          .setSessionSummary("real-1", "Title-1");
      });

      act(() => {
        useSessionsListStore
          .getState()
          .replaceSessionId(surfaceKey, opt2.session_id, "real-2");
      });

      act(() => {
        useSessionsListStore
          .getState()
          .setSessionSummary("real-2", "Title-2");
      });

      const rows =
        useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      const realOne = rows?.find((s) => s.session_id === "real-1");
      const realTwo = rows?.find((s) => s.session_id === "real-2");
      expect(realOne?.summary_of_previous_context).toBe("Title-1");
      expect(realTwo?.summary_of_previous_context).toBe("Title-2");
      expect(rows?.length).toBe(2);
    });
  });

});
