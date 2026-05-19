import { renderHook } from "@testing-library/react";

const mockSendMessage = vi.fn();
const mockStopStreaming = vi.fn();
const mockResetEvents = vi.fn();
const mockGetIsStreaming = vi.fn(() => false);
const storageState = new Map<string, string>();

vi.mock("./stream/store", () => ({
  getIsStreaming: (key: string) => mockGetIsStreaming(key),
}));

vi.mock("./use-agent-chat-stream", () => ({
  useAgentChatStream: vi.fn(() => ({
    streamKey: "test-stream-key",
    sendMessage: mockSendMessage,
    stopStreaming: mockStopStreaming,
    resetEvents: mockResetEvents,
    markNextSendAsNewSession: vi.fn(),
  })),
}));

interface MockUseChatHistorySyncArgs {
  fetchFn?: (() => Promise<unknown>) | undefined;
  historyKey?: string;
  streamKey?: string;
}
const { mockUseChatHistorySync } = vi.hoisted(() => ({
  mockUseChatHistorySync: vi.fn(() => ({
    historyResolved: true,
    isLoading: false,
    historyError: null,
    wrapSend: (fn: (...args: unknown[]) => unknown) => fn,
  })),
}));

vi.mock("./use-chat-history-sync", () => ({
  useChatHistorySync: (args: MockUseChatHistorySyncArgs) => mockUseChatHistorySync(args),
}));

vi.mock("../shared/hooks/use-delayed-loading", () => ({
  useDelayedLoading: vi.fn((loading: boolean) => loading),
}));

vi.mock("./use-agent-chat-meta", () => ({
  useStandaloneAgentMeta: vi.fn(() => ({
    agentName: "Test Agent",
    machineType: "local",
    templateAgentId: "template-1",
    adapterType: "aura_harness",
    defaultModel: "aura-gpt-5-4",
  })),
}));

// `vi.mock` is hoisted to the top of the file by vitest, so any
// top-level `const` referenced inside the factory would be in the
// temporal-dead-zone when the mock is constructed. `vi.hoisted` runs
// the factory at the same hoisted point, which lets us share a
// jest-fn handle between the mocked module surface and the
// per-test reset hooks below.
const { mockListEvents, mockListSessionEvents } = vi.hoisted(() => ({
  mockListEvents: vi.fn().mockResolvedValue([]),
  mockListSessionEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../api/client", () => ({
  api: {
    agents: {
      listEvents: mockListEvents,
      listSessionEvents: mockListSessionEvents,
      getContextUsage: vi.fn().mockResolvedValue({ context_utilization: 0 }),
      resetSession: vi.fn().mockResolvedValue(undefined),
      cancelTurn: vi.fn().mockResolvedValue(undefined),
    },
  },
  STANDALONE_AGENT_HISTORY_LIMIT: 50,
}));

const { mockClearHistory } = vi.hoisted(() => ({
  mockClearHistory: vi.fn(),
}));
vi.mock("../stores/chat-history-store", () => ({
  agentHistoryKey: (id: string) => `agent:${id}`,
  projectChatHistoryKey: (projectId: string, instanceId: string) =>
    `project:${projectId}:${instanceId}`,
  useChatHistoryStore: {
    getState: () => ({
      clearHistory: mockClearHistory,
    }),
  },
}));

const mockSetSelectedAgent = vi.fn();
vi.mock("../apps/agents/stores", () => ({
  useAgentStore: (selector: (s: { setSelectedAgent: typeof mockSetSelectedAgent }) => unknown) =>
    selector({ setSelectedAgent: mockSetSelectedAgent }),
}));

interface MockProject {
  project_id: string;
  name?: string;
  description?: string;
}
let mockProjects: MockProject[] = [];
let mockAgentsByProject: Record<string, { agent_id: string }[]> = {};
const mockRefreshProjects = vi.fn(() => Promise.resolve());

vi.mock("../stores/projects-list-store", () => {
  const buildState = () => ({
    projects: mockProjects,
    agentsByProject: mockAgentsByProject,
    refreshProjects: mockRefreshProjects,
  });
  type MockState = ReturnType<typeof buildState>;
  const useProjectsListStore = ((
    selector: (s: MockState) => unknown,
  ) => selector(buildState())) as unknown as {
    (selector: (s: MockState) => unknown): unknown;
    getState: () => MockState;
  };
  useProjectsListStore.getState = buildState;
  return { useProjectsListStore };
});

interface MockAnnotatedSession {
  session_id: string;
  _projectId: string;
}
let mockSessionsBySurface: Record<string, MockAnnotatedSession[]> = {};
const mockReplaceSessionId = vi.fn();
const mockBumpVersion = vi.fn();
const mockAddOptimisticSession = vi.fn();

vi.mock("../stores/sessions-list-store", () => {
  const buildState = () => ({
    sessionsBySurface: mockSessionsBySurface,
    replaceSessionId: mockReplaceSessionId,
    bumpVersion: mockBumpVersion,
    addOptimisticSession: mockAddOptimisticSession,
  });
  type MockState = ReturnType<typeof buildState>;
  const useSessionsListStore = ((
    selector: (s: MockState) => unknown,
  ) => selector(buildState())) as unknown as {
    (selector: (s: MockState) => unknown): unknown;
    getState: () => MockState;
  };
  useSessionsListStore.getState = buildState;
  return {
    useSessionsListStore,
    agentSessionsSurfaceKey: (id: string) => `agent:${id}`,
    projectSessionsSurfaceKey: (id: string) => `project:${id}`,
    buildOptimisticSession: (args: {
      optimisticId: string;
      projectId: string;
      projectName: string;
      agentInstanceId: string;
    }) => ({ session_id: args.optimisticId, _projectId: args.projectId }),
    OPTIMISTIC_SESSION_ID_PREFIX: "optimistic:",
  };
});

vi.mock("../stores/context-usage-store", () => ({
  useContextUsage: vi.fn(() => undefined),
  useContextUsageStore: {
    getState: () => ({
      clearContextUtilization: vi.fn(),
      markResetPending: vi.fn(),
    }),
  },
}));

const { mockMessageQueueClear } = vi.hoisted(() => ({
  mockMessageQueueClear: vi.fn(),
}));
vi.mock("../stores/message-queue-store", () => ({
  useMessageQueueStore: {
    getState: () => ({
      clear: mockMessageQueueClear,
    }),
  },
}));

vi.mock("./use-hydrate-context-utilization", () => ({
  useHydrateContextUtilization: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: vi.fn(() => [new URLSearchParams(), vi.fn()]),
}));

import { useStandaloneAgentChat } from "./use-standalone-agent-chat";

describe("useStandaloneAgentChat", () => {
  beforeEach(() => {
    mockProjects = [];
    mockAgentsByProject = {};
    mockSessionsBySurface = {};
    mockSendMessage.mockReset();
    mockStopStreaming.mockReset();
    mockResetEvents.mockReset();
    mockGetIsStreaming.mockReset();
    mockGetIsStreaming.mockImplementation(() => false);
    mockSetSelectedAgent.mockReset();
    mockRefreshProjects.mockClear();
    mockReplaceSessionId.mockReset();
    mockBumpVersion.mockReset();
    mockAddOptimisticSession.mockReset();
    mockListEvents.mockClear();
    mockListEvents.mockResolvedValue([]);
    mockListSessionEvents.mockClear();
    mockListSessionEvents.mockResolvedValue([]);
    mockMessageQueueClear.mockClear();
    mockUseChatHistorySync.mockClear();
    mockClearHistory.mockClear();
    storageState.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storageState.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storageState.set(key, value);
        },
        removeItem: (key: string) => {
          storageState.delete(key);
        },
        clear: () => {
          storageState.clear();
        },
        key: (index: number) => Array.from(storageState.keys())[index] ?? null,
        get length() {
          return storageState.size;
        },
      },
    });
  });

  it("returns a stable shell payload when agentId is undefined", () => {
    const { result } = renderHook(() => useStandaloneAgentChat(undefined));

    expect(result.current.agentId).toBeUndefined();
    expect(result.current.streamKey).toBe("test-stream-key");
  });

  it("returns chat props when agentId is provided", () => {
    const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

    expect(result.current.agentId).toBe("agent-1");
    expect(result.current.streamKey).toBe("test-stream-key");
  });

  it("provides chat panel props", () => {
    const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

    expect(result.current.agentName).toBe("Test Agent");
    expect(result.current.machineType).toBe("local");
    expect(result.current.templateAgentId).toBe("template-1");
    expect(result.current.adapterType).toBe("aura_harness");
    expect(result.current.defaultModel).toBe("aura-gpt-5-4");
    expect(result.current.agentId).toBe("agent-1");
    expect(result.current.emptyMessage).toBeUndefined();
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.historyResolved).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("exposes onSend and onStop", () => {
    const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

    expect(typeof result.current.onSend).toBe("function");
    expect(typeof result.current.onStop).toBe("function");
  });

  it("collapses the project picker to a single non-interactive entry", () => {
    // The Agents-app picker is locked to a static "Home" label; the
    // hook always returns a 1-item `projects` array regardless of how
    // many real project bindings the agent has. The picker is
    // non-interactive (`onProjectChange === undefined`), so
    // ChatInputBar renders it without a chevron or dropdown.
    mockProjects = [
      { project_id: "proj-1", name: "Alpha", description: "" },
      { project_id: "proj-2", name: "Beta", description: "" },
      { project_id: "proj-3", name: "Gamma", description: "" },
    ];
    mockAgentsByProject = {
      "proj-1": [{ agent_id: "agent-1" }],
      "proj-2": [{ agent_id: "agent-2" }],
      "proj-3": [{ agent_id: "agent-1" }],
    };

    const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects![0].name).toBe("Home");
    expect(result.current.onProjectChange).toBeUndefined();
  });

  it("targets the agent's first bound project for chat persistence when no selection persisted", () => {
    mockProjects = [{ project_id: "proj-1", name: "Alpha", description: "" }];
    mockAgentsByProject = { "proj-1": [{ agent_id: "agent-1" }] };

    const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

    expect(result.current.selectedProjectId).toBe("proj-1");
  });

  it("honors a persisted project selection as the chat-persistence target", () => {
    // Legacy selections written to localStorage before the Home pin
    // landed must still resolve to the same underlying binding so the
    // user's historical sessions stay reachable. The picker label
    // still reads "Home" thanks to the synthetic relabel.
    localStorage.setItem("aura-agent-project:agent-1", "proj-2");

    mockProjects = [
      { project_id: "proj-1", name: "Alpha", description: "" },
      { project_id: "proj-2", name: "Beta", description: "" },
    ];
    mockAgentsByProject = {
      "proj-1": [{ agent_id: "agent-1" }],
      "proj-2": [{ agent_id: "agent-1" }],
    };

    const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

    expect(result.current.selectedProjectId).toBe("proj-2");
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.projects![0].name).toBe("Home");
  });

  it("falls back to first project when persisted project no longer valid", () => {
    localStorage.setItem("aura-agent-project:agent-1", "proj-gone");

    mockProjects = [{ project_id: "proj-1", name: "Alpha", description: "" }];
    mockAgentsByProject = { "proj-1": [{ agent_id: "agent-1" }] };

    const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

    expect(result.current.selectedProjectId).toBe("proj-1");
  });

  it("scrollResetKey matches agentId", () => {
    const { result } = renderHook(() => useStandaloneAgentChat("agent-42"));

    expect(result.current.scrollResetKey).toBe("agent-42");
  });

  describe("home-project pinning", () => {
    // The standalone Agents-app surfaces pin to the agent's auto-created
    // Home project (see `apps/aura-os-server/src/handlers/agents/home_project.rs`
    // for how it's stamped). When the binding is present, the hook
    // collapses the project picker to a single non-interactive "Home"
    // label by trimming `projects` to that one entry and dropping
    // `onProjectChange`. Falls back to multi-project behavior only when
    // no Home binding exists.
    it("pins selectedProjectId to the Home project when bound (new marker)", () => {
      mockProjects = [
        { project_id: "proj-other", name: "Customer Work", description: "Other work" },
        {
          project_id: "proj-home",
          name: "Home",
          description: "[aura:agent-home] Auto-created workspace",
        },
      ];
      mockAgentsByProject = {
        "proj-other": [{ agent_id: "agent-1" }],
        "proj-home": [{ agent_id: "agent-1" }],
      };

      const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

      expect(result.current.selectedProjectId).toBe("proj-home");
      expect(result.current.projects).toHaveLength(1);
      expect(result.current.projects![0].project_id).toBe("proj-home");
      expect(result.current.onProjectChange).toBeUndefined();
    });

    it("recognizes the legacy CEO home marker", () => {
      mockProjects = [
        {
          project_id: "proj-ceo-home",
          name: "Home",
          description: "[aura:ceo-home] CEO workspace",
        },
        { project_id: "proj-side", name: "Side Project", description: "Side work" },
      ];
      mockAgentsByProject = {
        "proj-ceo-home": [{ agent_id: "agent-1" }],
        "proj-side": [{ agent_id: "agent-1" }],
      };

      const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

      expect(result.current.selectedProjectId).toBe("proj-ceo-home");
      expect(result.current.projects).toHaveLength(1);
      expect(result.current.onProjectChange).toBeUndefined();
    });

    it("ignores a user-authored project literally named 'Home' without the marker prefix", () => {
      // Mirrors `description_is_auto_home`'s rejection in the server
      // helper: only descriptions WE wrote are treated as auto-home.
      // The hook treats the user-authored "Home" as a regular legacy
      // binding and surfaces it through the synthetic Home label
      // path, NOT the real `homeProject` branch. Either way the
      // picker still reads "Home" — what we're asserting here is
      // that we don't blindly trust the name.
      mockProjects = [
        {
          project_id: "proj-user-home",
          name: "Home",
          description: "My personal workspace",
        },
      ];
      mockAgentsByProject = {
        "proj-user-home": [{ agent_id: "agent-1" }],
      };

      const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

      // The selected project's underlying id is the user's project,
      // not a real auto-home (none exists). The picker label is the
      // synthetic "Home" relabel of the user's project — confirmed by
      // the project's description NOT carrying the auto-home marker.
      expect(result.current.selectedProjectId).toBe("proj-user-home");
      expect(result.current.projects).toHaveLength(1);
      expect(result.current.projects![0].name).toBe("Home");
      expect(result.current.projects![0].description).toBe("My personal workspace");
      expect(result.current.onProjectChange).toBeUndefined();
    });

    it("synthesizes a 'Home' label for legacy agents with non-Home bindings", () => {
      // Existing agents created before the auto-Home heal landed
      // (e.g. the "zero-sdk-10"-bound agent in the screenshot from
      // the user report) still have their original project binding.
      // The Agents-app picker must read "Home" for them too — the
      // hook synthesizes a single-entry picker that keeps the real
      // project_id (so chat persistence keeps working) but rewrites
      // the displayed `name` to "Home".
      mockProjects = [
        { project_id: "zero-sdk-10", name: "zero-sdk-10", description: "Legacy" },
        { project_id: "proj-other", name: "Other", description: "" },
      ];
      mockAgentsByProject = {
        "zero-sdk-10": [{ agent_id: "agent-1" }],
        "proj-other": [{ agent_id: "agent-1" }],
      };

      const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

      expect(result.current.projects).toHaveLength(1);
      expect(result.current.projects![0].project_id).toBe("zero-sdk-10");
      expect(result.current.projects![0].name).toBe("Home");
      expect(result.current.selectedProjectId).toBe("zero-sdk-10");
      expect(result.current.onProjectChange).toBeUndefined();
    });

    it("home pinning overrides a persisted non-home selection", () => {
      // Stale `aura-agent-project:<id>` entries from before the
      // Home-pin rollout (or from a brief window when the user had
      // multiple bindings) must NOT win over the Home default.
      localStorage.setItem("aura-agent-project:agent-1", "proj-other");

      mockProjects = [
        { project_id: "proj-other", name: "Other", description: "" },
        {
          project_id: "proj-home",
          name: "Home",
          description: "[aura:agent-home] Auto-created workspace",
        },
      ];
      mockAgentsByProject = {
        "proj-other": [{ agent_id: "agent-1" }],
        "proj-home": [{ agent_id: "agent-1" }],
      };

      const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

      expect(result.current.selectedProjectId).toBe("proj-home");
      expect(result.current.onProjectChange).toBeUndefined();
    });
  });

  describe("llmProjectId (wire body.project_id)", () => {
    // The wire `project_id` is what the LLM sees as the active project
    // (drives `with_project_self_caps`, workspace path, the
    // `<project_context>` block — see `agent_route.rs::resolve_effective_project_id`).
    // It is intentionally decoupled from `selectedProjectId` (which
    // anchors the picker label and chat-persistence target). The
    // agents-app rules:
    //   - fresh canvas / new session / context reset: ship Home id;
    //   - existing pinned session: ship the session-of-record's
    //     original `_projectId` from `sessions-list-store`;
    //   - no Home binding yet: ship `undefined` and let the server's
    //     lazy heal create one — see `ensure_agent_home_project_and_binding`.

    it("pins llmProjectId to Home on a fresh canvas with a Home binding", () => {
      mockProjects = [
        { project_id: "proj-other", name: "Customer Work", description: "Other" },
        {
          project_id: "proj-home",
          name: "Home",
          description: "[aura:agent-home] Auto-created workspace",
        },
      ];
      mockAgentsByProject = {
        "proj-other": [{ agent_id: "agent-1" }],
        "proj-home": [{ agent_id: "agent-1" }],
      };

      const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

      expect(result.current.llmProjectId).toBe("proj-home");
    });

    it("ships llmProjectId=undefined when the agent has no Home binding (server self-heals)", () => {
      // Legacy agent bound only to a non-Home project. The picker
      // still synthesizes "Home" and `selectedProjectId` keeps the
      // legacy id for chat persistence, but the wire MUST NOT leak
      // the legacy project as `body.project_id`.
      mockProjects = [
        { project_id: "zero-sdk-10", name: "zero-sdk-10", description: "Legacy" },
      ];
      mockAgentsByProject = {
        "zero-sdk-10": [{ agent_id: "agent-1" }],
      };

      const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

      expect(result.current.selectedProjectId).toBe("zero-sdk-10");
      expect(result.current.llmProjectId).toBeUndefined();
    });

    it("looks up the originating project for an existing pinned session", () => {
      mockProjects = [
        {
          project_id: "proj-home",
          name: "Home",
          description: "[aura:agent-home] Auto-created workspace",
        },
        { project_id: "proj-customer", name: "Customer", description: "" },
      ];
      mockAgentsByProject = {
        "proj-home": [{ agent_id: "agent-1" }],
        "proj-customer": [{ agent_id: "agent-1" }],
      };
      mockSessionsBySurface = {
        "agent:agent-1": [
          { session_id: "session-A", _projectId: "proj-customer" },
        ],
      };

      const { result } = renderHook(() =>
        useStandaloneAgentChat("agent-1", "session-A"),
      );

      // Picker stays "Home" but the wire ships the session's
      // originating project so the LLM rebuilds the same context the
      // chat originally ran with.
      expect(result.current.selectedProjectId).toBe("proj-home");
      expect(result.current.llmProjectId).toBe("proj-customer");
    });

    it("falls back to Home when the pinned session is not in the sessions store yet", () => {
      // Sessions list still loading on first render. Until it
      // resolves, ship Home so the turn at least has a sensible
      // project context — when the list lands the next render will
      // pick up the real session project.
      mockProjects = [
        {
          project_id: "proj-home",
          name: "Home",
          description: "[aura:agent-home] Auto-created workspace",
        },
      ];
      mockAgentsByProject = {
        "proj-home": [{ agent_id: "agent-1" }],
      };
      mockSessionsBySurface = {};

      const { result } = renderHook(() =>
        useStandaloneAgentChat("agent-1", "session-not-loaded"),
      );

      expect(result.current.llmProjectId).toBe("proj-home");
    });

    it("triggers refreshProjects on mount when the agent has no bindings at all", () => {
      // A brand-new (or freshly-resurrected) agent that the local
      // projects store has not yet discovered. Nudging the store
      // here lets a server-side Home binding (created by
      // `ensure_agent_home_project_and_binding` during agent
      // bootstrap, or by a concurrent chat turn) materialize without
      // requiring a hard reload.
      mockProjects = [];
      mockAgentsByProject = {};

      renderHook(() => useStandaloneAgentChat("agent-1"));

      expect(mockRefreshProjects).toHaveBeenCalled();
    });

    it("does not trigger refreshProjects on mount when a Home binding is already present", () => {
      mockProjects = [
        {
          project_id: "proj-home",
          name: "Home",
          description: "[aura:agent-home] Auto-created workspace",
        },
      ];
      mockAgentsByProject = {
        "proj-home": [{ agent_id: "agent-1" }],
      };

      renderHook(() => useStandaloneAgentChat("agent-1"));

      expect(mockRefreshProjects).not.toHaveBeenCalled();
    });
  });

  describe("session-pin transition effect", () => {
    // Regression coverage for the "user message disappears mid-send"
    // flicker. The effect that reacts to `pinnedSessionId` changes
    // must NOT clear the stream slot on the post-`SessionReady` URL
    // flip (null → defined) — that would erase the optimistic user
    // bubble — and must NOT clear while a turn is actively streaming.
    // It must still clear when the user genuinely navigates between
    // two historical sessions.
    it("does not clear the stream when pinnedSessionId stays null across renders", () => {
      const { rerender } = renderHook(
        ({ sid }: { sid: string | null }) => useStandaloneAgentChat("agent-1", sid),
        { initialProps: { sid: null } },
      );

      mockResetEvents.mockClear();
      rerender({ sid: null });

      expect(mockResetEvents).not.toHaveBeenCalled();
    });

    it("does not clear the stream when pinnedSessionId flips null → defined (post-SessionReady)", () => {
      const { rerender } = renderHook(
        ({ sid }: { sid: string | null }) => useStandaloneAgentChat("agent-1", sid),
        { initialProps: { sid: null } },
      );

      mockResetEvents.mockClear();
      // Simulates `SessionReady` updating `?session=A` while the
      // current turn is still streaming — the stream slot already
      // holds the optimistic user message and must be preserved.
      rerender({ sid: "session-A" });

      expect(mockResetEvents).not.toHaveBeenCalled();
    });

    it("does not clear the stream when pinnedSessionId flips defined → null (handled by handleNewChat)", () => {
      const { rerender } = renderHook(
        ({ sid }: { sid: string | null }) => useStandaloneAgentChat("agent-1", sid),
        { initialProps: { sid: "session-A" } },
      );

      mockResetEvents.mockClear();
      rerender({ sid: null });

      // `handleNewChat` already calls `resetEvents` directly when the
      // user clicks "+", so the transition effect should stay out of
      // the way.
      expect(mockResetEvents).not.toHaveBeenCalled();
    });

    it("clears session B's slot on a cross-session navigation even while session A is still streaming", () => {
      // Phase 3: `useStreamCore` is now keyed on `(agentId, sessionId)`,
      // so `resetEvents` always targets the *new* pinned session's slot
      // (here `agent-1:session-B`). Session A's in-flight stream lives
      // on its own slot (`agent-1:session-A`) and is structurally
      // untouchable by the destination's clear. The previous
      // `getIsStreaming(streamKey)` bail-out guarded against the old
      // shared-key model where A's stream and B's transcript collided.
      // That guard is now dead code.
      mockGetIsStreaming.mockImplementation(() => true);

      const { rerender } = renderHook(
        ({ sid }: { sid: string | null }) => useStandaloneAgentChat("agent-1", sid),
        { initialProps: { sid: "session-A" } },
      );

      mockResetEvents.mockClear();
      rerender({ sid: "session-B" });

      expect(mockResetEvents).toHaveBeenCalledTimes(1);
      expect(mockResetEvents).toHaveBeenCalledWith([], {
        allowWhileStreaming: true,
      });
    });

    it("clears the stream on a true cross-session navigation when idle", () => {
      const { rerender } = renderHook(
        ({ sid }: { sid: string | null }) => useStandaloneAgentChat("agent-1", sid),
        { initialProps: { sid: "session-A" } },
      );

      mockResetEvents.mockClear();
      rerender({ sid: "session-B" });

      expect(mockResetEvents).toHaveBeenCalledTimes(1);
      expect(mockResetEvents).toHaveBeenCalledWith([], { allowWhileStreaming: true });
    });
  });

  describe("history fetch routing (Phase 4: per-session events endpoint)", () => {
    // Pull the most recent `fetchFn` the hook handed to
    // `useChatHistorySync`. The hook builds the fetcher inside a
    // `useMemo`, so reading it through the mock is the most direct
    // way to verify which API the next history hydrate will call.
    const latestFetchFn = (): (() => Promise<unknown>) | undefined => {
      const lastCall = mockUseChatHistorySync.mock.calls.at(-1);
      const args = lastCall?.[0] as MockUseChatHistorySyncArgs | undefined;
      return args?.fetchFn;
    };

    it("uses the per-agent timeline when no session is pinned", async () => {
      renderHook(() => useStandaloneAgentChat("agent-1", null));

      const fetchFn = latestFetchFn();
      expect(fetchFn).toBeDefined();
      await fetchFn?.();

      expect(mockListEvents).toHaveBeenCalledTimes(1);
      expect(mockListEvents).toHaveBeenCalledWith("agent-1", { limit: 50 });
      expect(mockListSessionEvents).not.toHaveBeenCalled();
    });

    it("uses the per-session endpoint when a session is pinned", async () => {
      // The user-visible bug Phase 4 closes: with a `?session=X`
      // pin, the hook must NOT fall back to `listEvents` (which
      // aggregates across every session of the agent and would drag
      // X's prior siblings back into the panel after a reset).
      renderHook(() => useStandaloneAgentChat("agent-1", "session-A"));

      const fetchFn = latestFetchFn();
      expect(fetchFn).toBeDefined();
      await fetchFn?.();

      expect(mockListSessionEvents).toHaveBeenCalledTimes(1);
      expect(mockListSessionEvents).toHaveBeenCalledWith(
        "agent-1",
        "session-A",
        { limit: 50 },
      );
      expect(mockListEvents).not.toHaveBeenCalled();
    });

    it("rebuilds the fetcher when pinnedSessionId changes", async () => {
      const { rerender } = renderHook(
        ({ sid }: { sid: string | null }) => useStandaloneAgentChat("agent-1", sid),
        { initialProps: { sid: "session-A" as string | null } },
      );

      await latestFetchFn()?.();
      expect(mockListSessionEvents).toHaveBeenLastCalledWith(
        "agent-1",
        "session-A",
        { limit: 50 },
      );

      mockListSessionEvents.mockClear();
      rerender({ sid: "session-B" });

      await latestFetchFn()?.();
      expect(mockListSessionEvents).toHaveBeenLastCalledWith(
        "agent-1",
        "session-B",
        { limit: 50 },
      );
    });
  });

  describe("queue clearing on reset (Phase 4)", () => {
    // Phase 1 made the chat send pipeline queue-by-default when a
    // stream is busy. Phase 4 closes the loop on the matching reset
    // affordance: pressing `+` (`handleNewChat`) must drop any queued
    // message so it doesn't bleed into the freshly-minted session as
    // the next dequeue's "first send". (The previous RotateCcw
    // `handleNewSession` reset path was retired alongside the inline
    // context-reset button.)
    it("handleNewChat clears useMessageQueueStore for the streamKey", () => {
      mockProjects = [
        {
          project_id: "proj-home",
          name: "Home",
          description: "[aura:agent-home] Auto-created workspace",
        },
      ];
      mockAgentsByProject = { "proj-home": [{ agent_id: "agent-1" }] };

      const { result } = renderHook(() => useStandaloneAgentChat("agent-1"));

      expect(typeof result.current.onNewChat).toBe("function");
      result.current.onNewChat?.();

      expect(mockMessageQueueClear).toHaveBeenCalledWith("test-stream-key");
    });
  });
});
