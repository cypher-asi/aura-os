import type { ButtonHTMLAttributes, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useParams: vi.fn(),
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
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => mocks.useParams(),
  };
});

vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../components/AgentEditorModal", () => ({
  AgentEditorModal: () => null,
}));

vi.mock("../AgentConversationRow", () => ({
  AgentConversationRow: ({ agent, onClick }: { agent: { name: string }; onClick: () => void }) => (
    <button type="button" onClick={onClick}>{agent.name}</button>
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
});
