import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { AgentChatView } from "./AgentChatView";

const mocks = vi.hoisted(() => ({
  params: { agentId: "agent-1", projectId: undefined, agentInstanceId: undefined },
  isMobileLayout: false,
  latestChatPanelProps: undefined as Record<string, unknown> | undefined,
  latestHistorySyncOptions: undefined as Record<string, unknown> | undefined,
  setSelectedAgent: vi.fn(),
  sendMessage: vi.fn(),
  stopStreaming: vi.fn(),
  resetEvents: vi.fn(),
  markNextSendAsNewSession: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => mocks.params,
  useLocation: () => ({ state: null }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock("../../../../api/client", () => ({
  api: {
    agents: {
      listEvents: vi.fn().mockResolvedValue([]),
      getContextUsage: vi.fn().mockResolvedValue({ context_utilization: 0 }),
      resetSession: vi.fn().mockResolvedValue(undefined),
    },
    getEvents: vi.fn().mockResolvedValue([]),
    listSessionEvents: vi.fn().mockResolvedValue([]),
    resetInstanceSession: vi.fn().mockResolvedValue(undefined),
    updateAgentInstance: vi.fn().mockResolvedValue({}),
    stopLoop: vi.fn().mockResolvedValue(undefined),
  },
  STANDALONE_AGENT_HISTORY_LIMIT: 50,
}));

vi.mock("../../../../hooks/use-agent-chat-stream", () => ({
  useAgentChatStream: () => ({
    streamKey: "agent-stream",
    sendMessage: mocks.sendMessage,
    stopStreaming: mocks.stopStreaming,
    resetEvents: mocks.resetEvents,
    markNextSendAsNewSession: mocks.markNextSendAsNewSession,
  }),
}));

vi.mock("../../../../hooks/use-chat-stream", () => ({
  useChatStream: () => ({
    streamKey: "project-stream",
    sendMessage: mocks.sendMessage,
    stopStreaming: mocks.stopStreaming,
    resetEvents: mocks.resetEvents,
    markNextSendAsNewSession: mocks.markNextSendAsNewSession,
  }),
}));

vi.mock("../../../../hooks/use-chat-history-sync", () => ({
  useChatHistorySync: (options: Record<string, unknown>) => {
    mocks.latestHistorySyncOptions = options;
    return {
      historyMessages: [],
      historyResolved: true,
      isLoading: false,
      historyError: null,
      wrapSend: (fn: (...args: unknown[]) => unknown) => fn,
    };
  },
}));

vi.mock("../../../../shared/hooks/use-delayed-loading", () => ({
  useDelayedLoading: (loading: boolean) => loading,
}));

vi.mock("../../../../hooks/use-agent-chat-meta", () => ({
  useAgentChatMeta: () => ({
    agentName: "Test Agent",
    machineType: "remote",
    templateAgentId: "template-1",
    adapterType: "aura_harness",
    defaultModel: "aura-gpt-5-4",
  }),
  useStandaloneAgentMeta: () => ({
    agentName: "Test Agent",
    machineType: "remote",
    templateAgentId: "template-1",
    adapterType: "aura_harness",
    defaultModel: "aura-gpt-5-4",
  }),
}));

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: mocks.isMobileLayout }),
}));

vi.mock("../../../../hooks/use-agent-busy", () => ({
  useAgentBusy: () => ({ isBusy: false, reason: null }),
}));

vi.mock("../../../../hooks/use-hydrate-context-utilization", () => ({
  useHydrateContextUtilization: vi.fn(),
}));

vi.mock("../../../../stores/context-usage-store", () => ({
  useContextUsage: () => undefined,
  useContextUsageStore: {
    getState: () => ({
      clearContextUtilization: vi.fn(),
      markResetPending: vi.fn(),
    }),
  },
}));

vi.mock("../../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { projects: unknown[]; agentsByProject: Record<string, unknown[]>; setAgentsByProject: () => void }) => unknown) =>
    selector({
      projects: [],
      agentsByProject: {},
      setAgentsByProject: vi.fn(),
    }),
}));

vi.mock("../../stores", () => ({
  LAST_AGENT_ID_KEY: "last-agent-id",
  useSelectedAgent: () => ({ setSelectedAgent: mocks.setSelectedAgent }),
  useAgentStore: (selector: (s: { setSelectedAgent: typeof mocks.setSelectedAgent }) => unknown) =>
    selector({ setSelectedAgent: mocks.setSelectedAgent }),
}));

vi.mock("../../../../stores/chat-handoff-store", () => ({
  useChatHandoffStore: () => vi.fn(),
}));

vi.mock("../../../../utils/chat-handoff", () => ({
  isCreateAgentChatHandoff: () => false,
  projectAgentHandoffTarget: vi.fn(),
  standaloneAgentHandoffTarget: vi.fn(),
}));

vi.mock("../../../../utils/storage", () => ({
  setLastAgent: vi.fn(),
  setLastProject: vi.fn(),
}));

vi.mock("../../../../lib/derive-project-agent-title", () => ({
  deriveProjectAgentTitle: () => "New Agent",
}));

vi.mock("../../../../queries/project-queries", () => ({
  mergeAgentIntoProjectAgents: vi.fn(),
  projectQueryKeys: {
    agentInstance: vi.fn(),
  },
}));

vi.mock("../../../../shared/lib/query-client", () => ({
  queryClient: {
    setQueryData: vi.fn(),
  },
}));

vi.mock("../../../chat/components/ChatPanel", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    mocks.latestChatPanelProps = props;
    return <div data-testid="chat-panel" />;
  },
}));

vi.mock("../../../../mobile/chat/MobileChatPanel", () => ({
  MobileChatPanel: () => <div data-testid="mobile-chat-panel" />,
}));

vi.mock("../../../../mobile/chat/MobileProjectAgentSwitcherSheet", () => ({
  MobileProjectAgentSwitcherSheet: () => null,
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./AgentChatView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("AgentChatView", () => {
  beforeEach(() => {
    mocks.params = { agentId: "agent-1", projectId: undefined, agentInstanceId: undefined };
    mocks.isMobileLayout = false;
    mocks.latestChatPanelProps = undefined;
    mocks.latestHistorySyncOptions = undefined;
  });

  it("uses ChatPanel's desktop input autofocus for standalone agents", () => {
    render(<AgentChatView />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(mocks.latestChatPanelProps).toEqual(
      expect.objectContaining({
        agentId: "agent-1",
        scrollResetKey: "agent-1",
      }),
    );
    expect(mocks.latestChatPanelProps).not.toHaveProperty("focusInputOnThreadReady");
  });

  it("watches standalone agent ids for cross-agent chat updates", () => {
    render(<AgentChatView />);

    expect(mocks.latestHistorySyncOptions).toEqual(
      expect.objectContaining({
        historyKey: "agent:agent-1",
        streamKey: "agent-stream",
        hydrateToStream: false,
        watchAgentId: "agent-1",
      }),
    );
  });
});
