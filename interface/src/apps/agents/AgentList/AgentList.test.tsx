import type { ButtonHTMLAttributes, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CREATE_AGENT_CHAT_HANDOFF } from "../../../utils/chat-handoff";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useParams: vi.fn(),
  useLocation: vi.fn(),
  fetchAgentsMock: vi.fn(async () => {}),
  useAgents: vi.fn(),
  useSelectedAgent: vi.fn(),
  useSortedAgents: vi.fn(),
  useSidebarSearch: vi.fn(),
  useAgentStore: vi.fn(),
  storeFetchAgents: vi.fn(),
  storeRemoveAgent: vi.fn(),
  storePatchAgent: vi.fn(),
  pendingCreateAgentHandoff: null as { target: string; label?: string } | null,
  beginCreateAgentHandoff: vi.fn((target: string, label?: string) => {
    mocks.pendingCreateAgentHandoff = { target, label };
  }),
  entries: {} as Record<string, unknown>,
  previewLastMessages: {} as Record<string, unknown>,
  useChatHistoryStore: Object.assign(
    (selector: (state: {
      entries: Record<string, unknown>;
      previewLastMessages: Record<string, unknown>;
    }) => unknown) =>
      selector({
        entries: mocks.entries,
        previewLastMessages: mocks.previewLastMessages,
      }),
    {
      getState: () => ({
        prefetchHistory: vi.fn(),
      }),
    },
  ),
  sessionsBySurface: {} as Record<string, Array<{
    session_id: string;
    _projectId: string;
    _agentInstanceId: string;
  }>>,
  loadAgentSessions: vi.fn(async () => {}),
  useSessionsListStore: Object.assign(
    (selector: (state: {
      sessionsBySurface: Record<string, unknown>;
    }) => unknown) =>
      selector({
        sessionsBySurface: mocks.sessionsBySurface,
      }),
    {
      getState: () => ({
        sessionsBySurface: mocks.sessionsBySurface,
        loadAgentSessions: mocks.loadAgentSessions,
      }),
    },
  ),
}));
Object.assign(mocks.useAgentStore, {
  getState: () => ({
    fetchAgents: mocks.storeFetchAgents,
    removeAgent: mocks.storeRemoveAgent,
    patchAgent: mocks.storePatchAgent,
  }),
});

vi.mock("@cypher-asi/zui", () => ({
  ButtonPlus: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>+</button>,
  Menu: ({
    items,
    onChange,
  }: {
    items: Array<{ id: string; label: string }>;
    onChange: (id: string) => void;
  }) => (
    <div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-testid={`menu-item-${item.id}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
  Modal: ({
    children,
    footer,
    isOpen,
    title,
  }: {
    children?: ReactNode;
    footer?: ReactNode;
    isOpen: boolean;
    title?: string;
  }) => (isOpen ? <div><div>{title}</div>{children}{footer}</div> : null),
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../components/ProjectsPlusButton", () => ({
  ProjectsPlusButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>+</button>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => mocks.useParams(),
    useLocation: () => mocks.useLocation(),
  };
});

vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/AgentEditorModal", () => ({
  AgentEditorModal: ({
    isOpen,
    onSaved,
  }: {
    isOpen: boolean;
    onSaved?: (agent: {
      agent_id: string;
      user_id: string;
      name: string;
      role: string;
      personality: string;
      system_prompt: string;
      skills: [];
      icon: null;
      machine_type: string;
      created_at: string;
      updated_at: string;
    }) => void;
  }) => (isOpen ? (
    <div>
      <div>Create Agent Modal</div>
      <button type="button" onClick={() => onSaved?.(agent)}>Save Agent</button>
    </div>
  ) : null),
}));

vi.mock("../AgentConversationRow", () => ({
  AgentConversationRow: ({
    agent,
    lastMessage,
    onClick,
    onContextMenu,
    onMouseEnter,
  }: {
    agent: { agent_id: string; name: string };
    lastMessage?: { content?: string };
    onClick: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    onMouseEnter?: () => void;
  }) => (
    <button
      id={agent.agent_id}
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      data-last-message-content={lastMessage?.content ?? ""}
    >
      {agent.name}
    </button>
  ),
}));

vi.mock("../../../stores/profile-status-store", () => ({
  useProfileStatusStore: (selector: (state: {
    statuses: Record<string, string>;
    registerAgents: (agents: unknown[]) => void;
    registerRemoteAgents: (agents: unknown[]) => void;
  }) => unknown) => selector({
    statuses: {},
    registerAgents: vi.fn(),
    registerRemoteAgents: vi.fn(),
  }),
}));

vi.mock("../../../api/client", () => ({
  STANDALONE_AGENT_HISTORY_LIMIT: 80,
  api: {
    agents: {
      listEvents: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
      listProjectBindings: vi.fn(async () => []),
      removeProjectBinding: vi.fn(async () => {}),
    },
    listSessionEvents: vi.fn(async () => []),
    listSessionEventsPaginated: vi.fn(async () => ({
      events: [],
      has_more: false,
      next_cursor: null,
    })),
  },
  ApiClientError: class ApiClientError extends Error {
    body = { error: "error" };
  },
}));

vi.mock("../stores", async () => {
  // Use the real `warmStandaloneAgentHistory` so the hover/click prefetch
  // tests exercise the actual warm chain — it runs against the mocked
  // chat-history / sessions-list / api stores declared below.
  const warm = await vi.importActual<
    typeof import("../stores/warm-standalone-agent-history")
  >("../stores/warm-standalone-agent-history");
  return {
    LAST_AGENT_ID_KEY: "aura:lastAgentId",
    useAgents: () => mocks.useAgents(),
    useSelectedAgent: () => mocks.useSelectedAgent(),
    useAgentStore: mocks.useAgentStore,
    useSortedAgents: () => mocks.useSortedAgents(),
    warmStandaloneAgentHistory: warm.warmStandaloneAgentHistory,
    warmStandaloneAgentSession: warm.warmStandaloneAgentSession,
  };
});

vi.mock("../../../stores/chat-history-store", () => ({
  useChatHistoryStore: mocks.useChatHistoryStore,
  agentHistoryKey: (agentId: string) => `agent:${agentId}`,
  sessionHistoryKey: (
    projectId: string,
    agentInstanceId: string,
    sessionId: string,
  ) => `session:${projectId}:${agentInstanceId}:${sessionId}`,
}));

vi.mock("../../../stores/sessions-list-store", () => ({
  agentSessionsSurfaceKey: (agentId: string) => `agent:${agentId}`,
  findMostRecentRealSession: <T,>(list: T[] | undefined) => list?.[0] ?? null,
  useSessionsListStore: mocks.useSessionsListStore,
}));

vi.mock("../../../stores/auth-store", () => ({
  useAuth: () => ({
    user: { network_user_id: "user-1" },
    isAuthenticated: true,
  }),
}));

vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: Object.assign(
    (selector: (state: { patchAgentTemplateFields: (agent: unknown) => void }) => unknown) =>
      selector({ patchAgentTemplateFields: vi.fn() }),
    {
      getState: () => ({
        patchAgentTemplateFields: vi.fn(),
        refreshProjectAgents: vi.fn(async () => []),
        refreshAgentInstancesForTemplate: vi.fn(),
      }),
    },
  ),
}));

vi.mock("../../../stores/chat-handoff-store", () => ({
  useChatHandoffStore: (selector: (state: {
    pendingCreateAgentHandoff: typeof mocks.pendingCreateAgentHandoff;
    beginCreateAgentHandoff: typeof mocks.beginCreateAgentHandoff;
  }) => unknown) => selector({
    pendingCreateAgentHandoff: mocks.pendingCreateAgentHandoff,
    beginCreateAgentHandoff: mocks.beginCreateAgentHandoff,
  }),
}));

vi.mock("../../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => mocks.useSidebarSearch(),
}));

vi.mock("./AgentList.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

// The batched row-model hook is exercised in its own suite; here we stub it so
// AgentList's behavior (navigation, prefetch, delete) is tested without wiring
// up every backing store. Preview still flows from the mocked cache so the
// preview-reactivity assertion holds.
vi.mock("./use-agent-row-models", () => ({
  useAgentRowModels: (agents: Array<{ agent_id: string }>) => {
    const map = new Map();
    for (const a of agents) {
      map.set(a.agent_id, {
        status: undefined,
        isLocal: true,
        busy: false,
        loopActivity: null,
        lastMessage: mocks.previewLastMessages[`agent:${a.agent_id}`],
        isPinned: false,
      });
    }
    return map;
  },
}));

import { AgentList } from "./AgentList";

const agent = {
  agent_id: "agent-1",
  user_id: "user-1",
  name: "Builder Bot",
  role: "Engineer",
  personality: "Helpful",
  system_prompt: "Build carefully",
  skills: [],
  icon: null,
  machine_type: "remote",
  created_at: "2026-03-20T00:00:00Z",
  updated_at: "2026-03-20T00:00:00Z",
};

const secondAgent = {
  ...agent,
  agent_id: "agent-2",
  name: "Reviewer Bot",
  updated_at: "2026-03-19T00:00:00Z",
};

describe("AgentList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pendingCreateAgentHandoff = null;
    mocks.entries = {};
    mocks.previewLastMessages = {};
    mocks.sessionsBySurface = {};
    mocks.loadAgentSessions = vi.fn(async () => {});
    mocks.storeFetchAgents = vi.fn();
    mocks.storeRemoveAgent = vi.fn();
    mocks.storePatchAgent = vi.fn();
    mocks.useAgentStore.mockImplementation((selector: (state: {
      togglePin: (agentId: string) => void;
      toggleFavorite: (agentId: string) => void;
      pinnedAgentIds: Set<string>;
      favoriteAgentIds: Set<string>;
    }) => unknown) => selector({
      togglePin: vi.fn(),
      toggleFavorite: vi.fn(),
      pinnedAgentIds: new Set<string>(),
      favoriteAgentIds: new Set<string>(),
    }));
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
    mocks.fetchAgentsMock = vi.fn(async () => {});
    mocks.useAgents.mockReturnValue({
      agents: [agent],
      status: "ready",
      fetchAgents: mocks.fetchAgentsMock,
    });
    mocks.useSelectedAgent.mockReturnValue({
      setSelectedAgent: vi.fn(),
    });
    mocks.useSortedAgents.mockReturnValue([agent]);
    mocks.useSidebarSearch.mockReturnValue({
      query: "",
      setAction: vi.fn(),
    });
    mocks.useLocation.mockReturnValue({
      pathname: "/agents",
      search: "",
    });
  });

  it("navigates to the agent route in mobile-library mode", async () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    const user = userEvent.setup();

    render(<AgentList mode="mobile-library" />);
    expect(mocks.fetchAgentsMock).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Builder Bot" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/agents/agent-1");
  });

  it("does not navigate when clicking the already selected agent", async () => {
    mocks.useParams.mockReturnValue({ agentId: "agent-1" });
    const user = userEvent.setup();

    render(<AgentList />);
    expect(mocks.fetchAgentsMock).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Builder Bot" }));

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows a loading state instead of the create-first copy while loading", () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    mocks.useAgents.mockReturnValue({
      agents: [],
      status: "loading",
      fetchAgents: mocks.fetchAgentsMock,
    });
    mocks.useSortedAgents.mockReturnValue([]);

    render(<AgentList />);

    expect(screen.getByText("Loading agents…")).toBeInTheDocument();
    expect(
      screen.queryByText(/Create your first AI agent/),
    ).not.toBeInTheDocument();
  });

  it("shows the create-first copy once loading settles with no agents", () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    mocks.useAgents.mockReturnValue({
      agents: [],
      status: "ready",
      fetchAgents: mocks.fetchAgentsMock,
    });
    mocks.useSortedAgents.mockReturnValue([]);

    render(<AgentList />);

    expect(
      screen.getByText(/Create your first AI agent/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading agents…")).not.toBeInTheDocument();
  });

  it("prefetches a bounded recent history window on hover", async () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    const user = userEvent.setup();
    const prefetchHistory = vi.fn();
    const fetchHistory = vi.fn(async () => {});
    const listEvents = vi.fn(async () => []);
    mocks.useChatHistoryStore.getState = () => ({
      prefetchHistory,
      fetchHistory,
    });
    const client = await import("../../../api/client");
    vi.spyOn(client.api.agents, "listEvents").mockImplementation(listEvents);

    render(<AgentList />);
    await user.hover(screen.getByRole("button", { name: "Builder Bot" }));

    expect(prefetchHistory).toHaveBeenCalledWith(
      "agent:agent-1",
      expect.any(Function),
    );

    const fetchFn = prefetchHistory.mock.calls[0][1] as () => Promise<unknown>;
    await fetchFn();

    expect(listEvents).toHaveBeenCalledWith("agent-1", {
      limit: client.STANDALONE_AGENT_HISTORY_LIMIT,
    });
  });

  // Hover prefetch must also warm the project-session destination, not
  // just the standalone-history slot. Without this, clicking the agent
  // row routes into a `session:...` historyKey that the chat-history-
  // store has never seen → `historyResolved=false` on first render →
  // `ChatPanel` re-arms its cold-load gate (`.messageContentHidden` +
  // overlay fade). Verifies the full chain: hover → loadAgentSessions
  // → fetchHistory of the session key with the right `listSessionEvents`
  // payload, so the click lands a `historyResolved=true` first render.
  it("warms the most-recent project-session history on hover", async () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    const user = userEvent.setup();
    const prefetchHistory = vi.fn();
    const fetchHistory = vi.fn(async () => {});
    mocks.useChatHistoryStore.getState = () => ({
      prefetchHistory,
      fetchHistory,
    });

    const loadAgentSessions = vi.fn(async () => {
      mocks.sessionsBySurface["agent:agent-1"] = [
        {
          session_id: "sess-most-recent",
          _projectId: "proj-1",
          _agentInstanceId: "inst-1",
        },
      ];
    });
    mocks.useSessionsListStore.getState = () => ({
      sessionsBySurface: mocks.sessionsBySurface,
      loadAgentSessions,
    });

    const listSessionEventsPaginated = vi.fn(async () => ({
      events: [],
      has_more: false,
      next_cursor: null,
    }));
    const client = await import("../../../api/client");
    vi.spyOn(client.api, "listSessionEventsPaginated").mockImplementation(
      listSessionEventsPaginated as never,
    );

    render(<AgentList />);
    await user.hover(screen.getByRole("button", { name: "Builder Bot" }));

    await waitFor(() => {
      expect(loadAgentSessions).toHaveBeenCalledWith("agent-1");
    });
    await waitFor(() => {
      expect(fetchHistory).toHaveBeenCalledWith(
        "session:proj-1:inst-1:sess-most-recent",
        expect.any(Function),
      );
    });

    const sessionFetchFn = fetchHistory.mock.calls.find(
      (call) => call[0] === "session:proj-1:inst-1:sess-most-recent",
    )?.[1] as (() => Promise<unknown>) | undefined;
    expect(sessionFetchFn).toBeDefined();
    await sessionFetchFn?.();
    expect(listSessionEventsPaginated).toHaveBeenCalledWith(
      "proj-1",
      "inst-1",
      "sess-most-recent",
      { limit: 100 },
    );
  });

  // Cached sessions short-circuit `loadAgentSessions` — repeat hovers
  // should only ever issue `fetchHistory` on the destination key.
  it("warms the destination session immediately when sessions are already cached", async () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    const user = userEvent.setup();
    const fetchHistory = vi.fn(async () => {});
    mocks.useChatHistoryStore.getState = () => ({
      prefetchHistory: vi.fn(),
      fetchHistory,
    });

    mocks.sessionsBySurface["agent:agent-1"] = [
      {
        session_id: "sess-cached",
        _projectId: "proj-1",
        _agentInstanceId: "inst-1",
      },
    ];
    const loadAgentSessions = vi.fn(async () => {});
    mocks.useSessionsListStore.getState = () => ({
      sessionsBySurface: mocks.sessionsBySurface,
      loadAgentSessions,
    });

    render(<AgentList />);
    await user.hover(screen.getByRole("button", { name: "Builder Bot" }));

    expect(loadAgentSessions).not.toHaveBeenCalled();
    expect(fetchHistory).toHaveBeenCalledWith(
      "session:proj-1:inst-1:sess-cached",
      expect.any(Function),
    );
  });

  it("prefetches history for every visible agent on desktop sidebar mount", async () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    mocks.useAgents.mockReturnValue({
      agents: [agent, secondAgent],
      status: "ready",
      fetchAgents: vi.fn(async () => {}),
    });
    mocks.useSortedAgents.mockReturnValue([agent, secondAgent]);
    const prefetchHistory = vi.fn();
    const fetchHistory = vi.fn(async () => {});
    mocks.useChatHistoryStore.getState = () => ({
      prefetchHistory,
      fetchHistory,
    });

    render(<AgentList />);

    await waitFor(() => {
      expect(fetchHistory).toHaveBeenCalledWith(
        "agent:agent-1",
        expect.any(Function),
      );
      expect(fetchHistory).toHaveBeenCalledWith(
        "agent:agent-2",
        expect.any(Function),
      );
    });
  });

  it("uses the preview message cache for row previews", () => {
    mocks.useParams.mockReturnValue({ agentId: "agent-1" });
    mocks.previewLastMessages = {
      "agent:agent-1": { id: "evt-1", role: "assistant", content: "Stable preview" },
    };

    const view = render(<AgentList />);
    const row = screen.getByRole("button", { name: "Builder Bot" });
    expect(row).toHaveAttribute("data-last-message-content", "Stable preview");

    mocks.previewLastMessages = {};
    view.rerender(<AgentList />);
    expect(row).toHaveAttribute("data-last-message-content", "");
  });

  it("does not prefetch history on mount in mobile-library mode", async () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    mocks.useAgents.mockReturnValue({
      agents: [agent, secondAgent],
      status: "ready",
      fetchAgents: mocks.fetchAgentsMock,
    });
    mocks.useSortedAgents.mockReturnValue([agent, secondAgent]);
    const prefetchHistory = vi.fn();
    const fetchHistory = vi.fn(async () => {});
    mocks.useChatHistoryStore.getState = () => ({
      prefetchHistory,
      fetchHistory,
    });

    render(<AgentList mode="mobile-library" />);

    await Promise.resolve();
    expect(fetchHistory).not.toHaveBeenCalled();
  });

  it("opens the shared editor from the mobile create query", () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    mocks.useLocation.mockReturnValue({
      pathname: "/agents",
      search: "?create=1",
    });

    render(<AgentList mode="mobile-library" />);

    expect(screen.getByText("Create Agent Modal")).toBeVisible();
  });

  it("navigates with create handoff state after saving a new agent", async () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    mocks.useLocation.mockReturnValue({
      pathname: "/agents",
      search: "?create=1",
    });
    const user = userEvent.setup();

    const view = render(<AgentList mode="mobile-library" />);

    await user.click(screen.getByRole("button", { name: "Save Agent" }));

    expect(screen.getByText("Create Agent Modal")).toBeVisible();
    expect(mocks.navigate).toHaveBeenCalledWith("/agents/agent-1", {
      state: {
        agentChatHandoff: {
          type: CREATE_AGENT_CHAT_HANDOFF,
        },
      },
    });

    mocks.pendingCreateAgentHandoff = null;
    view.rerender(<AgentList mode="mobile-library" />);

    expect(screen.queryByText("Create Agent Modal")).not.toBeInTheDocument();
  });

  it("optimistically removes the deleted agent and selects a replacement", async () => {
    mocks.useParams.mockReturnValue({ agentId: "agent-1" });
    mocks.useAgents.mockReturnValue({
      agents: [agent, secondAgent],
      status: "ready",
      fetchAgents: vi.fn(async () => {}),
    });
    mocks.useSortedAgents.mockReturnValue([agent, secondAgent]);
    const setSelectedAgent = vi.fn();
    mocks.useSelectedAgent.mockReturnValue({
      setSelectedAgent,
    });

    let resolveDelete: (() => void) | undefined;
    const client = await import("../../../api/client");
    vi.spyOn(client.api.agents, "delete").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );

    const user = userEvent.setup();
    render(<AgentList />);

    fireEvent.contextMenu(screen.getByRole("button", { name: "Builder Bot" }));
    await user.click(screen.getByTestId("menu-item-delete"));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByRole("button", { name: "Builder Bot" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reviewer Bot" })).toBeInTheDocument();
    expect(setSelectedAgent).toHaveBeenCalledWith("agent-2");
    expect(mocks.navigate).toHaveBeenCalledWith("/agents/agent-2");

    resolveDelete?.();

    await waitFor(() => {
      expect(mocks.storeRemoveAgent).toHaveBeenCalledWith("agent-1");
      expect(mocks.storeFetchAgents).toHaveBeenCalledWith({ force: true });
    });
  });
});
