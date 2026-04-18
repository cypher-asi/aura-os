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
  useChatHistoryStore: Object.assign(
    (selector: (state: { entries: Record<string, unknown> }) => unknown) => selector({ entries: {} }),
    {
      getState: () => ({
        prefetchHistory: vi.fn(),
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

vi.mock("../../../components/AgentEditorModal", () => ({
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
    onClick,
    onContextMenu,
    onMouseEnter,
  }: {
    agent: { agent_id: string; name: string };
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
    },
  },
  ApiClientError: class ApiClientError extends Error {
    body = { error: "error" };
  },
}));

vi.mock("../stores", () => ({
  LAST_AGENT_ID_KEY: "aura:lastAgentId",
  useAgents: () => mocks.useAgents(),
  useSelectedAgent: () => mocks.useSelectedAgent(),
  useAgentStore: mocks.useAgentStore,
  useSortedAgents: () => mocks.useSortedAgents(),
}));

vi.mock("../../../stores/chat-history-store", () => ({
  useChatHistoryStore: mocks.useChatHistoryStore,
  agentHistoryKey: (agentId: string) => `agent:${agentId}`,
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

  it("keeps desktop navigation behavior for the selected agent", async () => {
    mocks.useParams.mockReturnValue({ agentId: "agent-1" });
    const user = userEvent.setup();

    render(<AgentList />);
    expect(mocks.fetchAgentsMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Builder Bot" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/agents/agent-1");
  });

  it("prefetches a bounded recent history window on hover", async () => {
    mocks.useParams.mockReturnValue({ agentId: undefined });
    const user = userEvent.setup();
    const prefetchHistory = vi.fn();
    const listEvents = vi.fn(async () => []);
    mocks.useChatHistoryStore.getState = () => ({
      prefetchHistory,
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
