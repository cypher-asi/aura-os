import type { ButtonHTMLAttributes, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useParams: vi.fn(),
  useLocation: vi.fn(),
  useAgents: vi.fn(),
  useSelectedAgent: vi.fn(),
  useSortedAgents: vi.fn(),
  useSidebarSearch: vi.fn(),
  useAgentStore: vi.fn(),
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
    fetchAgents: vi.fn(),
  }),
});

vi.mock("@cypher-asi/zui", () => ({
  ButtonPlus: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>+</button>,
  Menu: () => null,
  Modal: ({ children, isOpen }: { children?: ReactNode; isOpen: boolean }) => (isOpen ? <div>{children}</div> : null),
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
  AgentEditorModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>Create Agent Modal</div> : null),
}));

vi.mock("../AgentConversationRow", () => ({
  AgentConversationRow: ({
    agent,
    onClick,
    onMouseEnter,
  }: {
    agent: { name: string };
    onClick: () => void;
    onMouseEnter?: () => void;
  }) => (
    <button type="button" onClick={onClick} onMouseEnter={onMouseEnter}>
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

describe("AgentList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
    mocks.useAgents.mockReturnValue({
      agents: [agent],
      status: "ready",
      fetchAgents: vi.fn(async () => {}),
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
    await user.click(screen.getByRole("button", { name: "Builder Bot" }));

    expect(mocks.navigate).toHaveBeenCalledWith("/agents/agent-1");
  });

  it("keeps desktop navigation behavior for the selected agent", async () => {
    mocks.useParams.mockReturnValue({ agentId: "agent-1" });
    const user = userEvent.setup();

    render(<AgentList />);
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
});
