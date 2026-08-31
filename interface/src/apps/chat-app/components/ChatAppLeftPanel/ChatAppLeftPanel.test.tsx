import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ChatAppLeftPanel } from "./ChatAppLeftPanel";

type FakeAgent = { agent_id: string; name: string; icon?: string | null };
type FakeRow = {
  session_id: string;
  _projectId: string;
  _agentInstanceId: string;
  _agentId?: string;
};

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  searchParams: new URLSearchParams(),
  chatAgent: { agent_id: "ceo", name: "CEO" } as FakeAgent | null,
  agents: [] as FakeAgent[],
  sessions: [] as FakeRow[],
  storeAgents: [] as FakeAgent[],
  agentsGet: vi.fn(),
  listSessionEvents: vi.fn().mockResolvedValue([]),
  pinKey: vi.fn(),
  unpinKey: vi.fn(),
  fetchHistory: vi.fn(),
  setStoreState: vi.fn(),
  patchAgent: vi.fn(),
  loadUserSessions: vi.fn().mockResolvedValue(undefined),
  loadAgentBindings: vi.fn().mockResolvedValue(undefined),
  setAction: vi.fn(),
  setDraft: vi.fn(),
  drafts: {} as Record<string, string>,
  remoteOnly: false,
  agentStatus: "ready",
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams, vi.fn()],
}));

vi.mock("../../../../api/client", () => ({
  api: {
    agents: {
      get: (...args: unknown[]) => mocks.agentsGet(...args),
      listSessionEvents: (...args: unknown[]) =>
        mocks.listSessionEvents(...args),
    },
  },
  STANDALONE_AGENT_HISTORY_LIMIT: 80,
}));

vi.mock("../../../../components/SessionsList", () => ({
  SessionsList: (props: {
    sessions: FakeRow[];
    onSessionClick: (s: FakeRow) => void;
    onSessionHover?: (s: FakeRow) => void;
    renderRowSuffix?: (s: FakeRow) => React.ReactNode;
  }) => (
    <div data-testid="sessions-list">
      {props.sessions.map((s) => (
        <button
          key={s.session_id}
          data-testid={`row-${s.session_id}`}
          onClick={() => props.onSessionClick(s)}
          onMouseEnter={() => props.onSessionHover?.(s)}
        >
          <span data-testid={`suffix-${s.session_id}`}>
            {props.renderRowSuffix?.(s)}
          </span>
        </button>
      ))}
    </div>
  ),
  formatDeleteSessionError: (e: unknown) => String(e),
  deriveSessionLabel: () => "Session title",
  useSessionArchiveActions: () => ({
    archiveSession: vi.fn(),
    restoreArchivedSession: vi.fn(),
  }),
  useSessionRenameAction: () => vi.fn(),
  useSessionPinAction: () => vi.fn(),
  useSessionSnoozeAction: () => vi.fn(),
}));

vi.mock("../../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
}));

vi.mock("../../../../components/Avatar", () => ({
  Avatar: () => <div data-testid="avatar" />,
}));

vi.mock("../../../../components/ProjectsPlusButton", () => ({
  ProjectsPlusButton: ({
    onClick,
    disabled,
  }: {
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button data-testid="plus" disabled={disabled} onClick={onClick} />
  ),
}));

vi.mock("../../../../stores/sessions-list-store", () => ({
  userSessionsSurfaceKey: () => "user:me",
  useSessionsDeleteError: () => null,
  useSessionsListActions: () => ({
    loadAgentBindings: mocks.loadAgentBindings,
    loadUserSessions: mocks.loadUserSessions,
    removeSession: vi.fn(),
    restoreSession: vi.fn(),
    setDeleteError: vi.fn(),
  }),
  useSessionsListStore: (
    selector: (state: {
      version: number;
      bindingsByAgent: Record<string, unknown>;
    }) => unknown,
  ) => selector({ version: 0, bindingsByAgent: {} }),
}));

vi.mock("../../../../stores/chat-history-store", () => ({
  agentSessionHistoryKey: (agentId: string, sessionId: string) =>
    `agent:${agentId}:session:${sessionId}`,
  sessionHistoryKey: (projectId: string, instanceId: string, sessionId: string) =>
    `session:${projectId}:${instanceId}:${sessionId}`,
  useChatHistoryStore: {
    getState: () => ({
      pinKey: mocks.pinKey,
      unpinKey: mocks.unpinKey,
      fetchHistory: mocks.fetchHistory,
    }),
  },
}));

vi.mock("../../../../stores/chat-ui-store", () => ({
  useChatUIStore: {
    getState: () => ({
      getDraft: (streamKey: string) => mocks.drafts[streamKey] ?? "",
      setDraft: (...args: [string, string]) => mocks.setDraft(...args),
    }),
  },
}));

vi.mock("../../../../hooks/stream/store", () => ({
  keyForAgentSession: (agentId: string, sessionId: string) =>
    `${agentId}:${sessionId}`,
}));

vi.mock("../../../../stores/projects-list-store", () => ({
  useProjectsListStore: { getState: () => ({}) },
}));

vi.mock("../../../../shared/lib/query-client", () => ({
  queryClient: { setQueryData: vi.fn() },
}));

vi.mock("../../../../queries/project-queries", () => ({
  mergeAgentIntoProjectAgents: vi.fn(),
  projectQueryKeys: { agentInstance: vi.fn() },
}));

vi.mock("../../../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => ({ query: "", setAction: mocks.setAction }),
}));

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ remoteOnly: mocks.remoteOnly }),
}));

vi.mock("../../../agents/stores", () => ({
  useAgents: () => ({ agents: mocks.agents }),
  useAgentStore: {
    getState: () => ({
      agents: mocks.storeAgents,
      patchAgent: mocks.patchAgent,
    }),
    setState: (...args: unknown[]) => mocks.setStoreState(...args),
  },
}));

vi.mock("../../hooks/use-chat-app-agent", () => ({
  useChatAppAgent: () => ({
    agent: mocks.chatAgent,
    status: mocks.agentStatus,
  }),
}));

vi.mock("../../hooks/use-chat-app-sessions", () => ({
  useChatAppSessions: () => ({ sessions: mocks.sessions, loading: false }),
}));

const recallResult = vi.hoisted(() => ({
  eventId: "source-event",
  sessionId: "source-session",
  projectId: "source-project",
  agentInstanceId: "source-instance",
  agentId: "source-agent",
  occurredAt: "2026-08-04T10:00:00Z",
  role: "assistant",
  snippet: "bounded recalled evidence",
} as const));

vi.mock("../RecallModal/RecallModal", () => ({
  RecallModal: (props: {
    isOpen: boolean;
    canAddToDraft: boolean;
    onOpenSource: (result: typeof recallResult) => void;
    onAddToDraft: (result: typeof recallResult) => void;
  }) => props.isOpen ? (
    <div data-testid="recall-modal">
      <button type="button" onClick={() => props.onOpenSource(recallResult)}>Open recall source</button>
      <button
        type="button"
        disabled={!props.canAddToDraft}
        onClick={() => props.onAddToDraft(recallResult)}
      >
        Add recall to draft
      </button>
    </div>
  ) : null,
}));

describe("ChatAppLeftPanel", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.agentsGet.mockReset();
    mocks.agentsGet.mockResolvedValue({ agent_id: "x", name: "X" });
    mocks.listSessionEvents.mockReset();
    mocks.listSessionEvents.mockResolvedValue([]);
    mocks.fetchHistory.mockReset();
    mocks.setAction.mockReset();
    mocks.searchParams = new URLSearchParams();
    mocks.chatAgent = { agent_id: "ceo", name: "CEO" };
    mocks.agents = [];
    mocks.storeAgents = [];
    mocks.sessions = [];
    mocks.remoteOnly = false;
    mocks.agentStatus = "ready";
    mocks.drafts = {};
    mocks.setDraft.mockReset();
    mocks.setDraft.mockImplementation((streamKey: string, text: string) => {
      mocks.drafts[streamKey] = text;
    });
  });

  // Regression: a session owned by an agent the active org doesn't
  // surface (`useAgents()` is org-scoped) must still navigate with the
  // row's true `_agentId`, not the CEO chat-agent fallback -- the
  // fallback 404'd the per-session events read ("session not found").
  it("navigates with the row's true _agentId when the owner isn't in the active-org list", () => {
    mocks.sessions = [
      {
        session_id: "s1",
        _projectId: "p1",
        _agentInstanceId: "i1",
        _agentId: "out-of-org-agent",
      },
    ];
    mocks.agents = []; // active org does not surface "out-of-org-agent"

    render(<ChatAppLeftPanel />);
    fireEvent.click(screen.getByTestId("row-s1"));

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    const url = mocks.navigate.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("agent")).toBe("out-of-org-agent");
    expect(params.get("session")).toBe("s1");
    // Heals the store so the destination route + sidekick resolve the
    // right agent.
    expect(mocks.agentsGet).toHaveBeenCalledWith("out-of-org-agent");
  });

  it("warms the chat-history cache under the row's true _agentId on hover", () => {
    mocks.sessions = [
      {
        session_id: "s1",
        _projectId: "p1",
        _agentInstanceId: "i1",
        _agentId: "out-of-org-agent",
      },
    ];
    mocks.agents = [];

    render(<ChatAppLeftPanel />);
    fireEvent.mouseEnter(screen.getByTestId("row-s1"));

    expect(mocks.fetchHistory).toHaveBeenCalledWith(
      "agent:out-of-org-agent:session:s1",
      expect.any(Function),
    );
  });

  // Fresh-canvas / legacy rows with no `_agentId` keep falling back to
  // the CEO chat agent so `/chat` behaviour is unchanged.
  it("falls back to the chat agent when the row carries no _agentId", () => {
    mocks.sessions = [
      { session_id: "s2", _projectId: "p1", _agentInstanceId: "i1" },
    ];

    render(<ChatAppLeftPanel />);
    fireEvent.click(screen.getByTestId("row-s2"));

    const url = mocks.navigate.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("agent")).toBe("ceo");
    expect(mocks.agentsGet).not.toHaveBeenCalled();
  });

  it("wires the sidebar plus button to a fresh chat route instead of the agent selector", () => {
    render(<ChatAppLeftPanel />);

    const action = mocks.setAction.mock.calls.find(
      ([key, node]) => key === "chat" && node != null,
    )?.[1] as React.ReactElement;
    expect(action).toBeTruthy();
    render(action);
    fireEvent.click(screen.getByTestId("plus"));

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    const url = mocks.navigate.mock.calls[0][0] as string;
    expect(url.startsWith("/chat?fresh=")).toBe(true);
    expect(url).not.toContain("agent=");
    expect(url).not.toContain("project=");
  });

  it("labels the row avatar with the owning agent without adding a secondary row", () => {
    mocks.sessions = [
      {
        session_id: "s3",
        _projectId: "p3",
        _agentInstanceId: "i3",
        _agentId: "agent-designer",
      },
    ];
    mocks.agents = [{ agent_id: "agent-designer", name: "Designer" }];

    render(<ChatAppLeftPanel />);

    expect(screen.queryByTestId("detail-s3")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agent: Designer")).toBeInTheDocument();
  });

  it("opens a Recall source without changing the active draft", () => {
    mocks.searchParams = new URLSearchParams("agent=active-agent&session=active-session");
    mocks.drafts["active-agent:active-session"] = "Keep this draft";
    render(<ChatAppLeftPanel />);

    const action = mocks.setAction.mock.calls.find(
      ([key, node]) => key === "chat" && node != null,
    )?.[1] as React.ReactElement;
    render(action);
    fireEvent.click(screen.getByRole("button", { name: "Recall past chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Open recall source" }));

    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining("session=source-session"));
    expect(mocks.drafts["active-agent:active-session"]).toBe("Keep this draft");
    expect(mocks.setDraft).not.toHaveBeenCalled();
  });

  it("appends evidence only to the active draft and never navigates", () => {
    mocks.searchParams = new URLSearchParams("agent=active-agent&session=active-session");
    mocks.drafts = {
      "active-agent:active-session": "Keep this draft",
      "other-agent:other-session": "Other draft",
    };
    render(<ChatAppLeftPanel />);

    const action = mocks.setAction.mock.calls.find(
      ([key, node]) => key === "chat" && node != null,
    )?.[1] as React.ReactElement;
    render(action);
    fireEvent.click(screen.getByRole("button", { name: "Recall past chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Add recall to draft" }));

    expect(mocks.drafts["active-agent:active-session"]).toContain("Keep this draft");
    expect(mocks.drafts["active-agent:active-session"]).toContain(recallResult.snippet);
    expect(mocks.drafts["active-agent:active-session"]).toContain("session source-session, event source-event");
    expect(mocks.drafts["other-agent:other-session"]).toBe("Other draft");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("targets a legacy selected session's authoritative agent draft", () => {
    mocks.searchParams = new URLSearchParams("session=legacy-session");
    mocks.sessions = [{
      session_id: "legacy-session",
      _projectId: "legacy-project",
      _agentInstanceId: "legacy-instance",
      _agentId: "legacy-owner",
    }];
    render(<ChatAppLeftPanel />);

    const action = mocks.setAction.mock.calls.find(
      ([key, node]) => key === "chat" && node != null,
    )?.[1] as React.ReactElement;
    render(action);
    fireEvent.click(screen.getByRole("button", { name: "Recall past chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Add recall to draft" }));

    expect(mocks.setDraft).toHaveBeenCalledWith(
      "legacy-owner:legacy-session",
      expect.stringContaining(recallResult.snippet),
    );
    expect(mocks.setDraft).not.toHaveBeenCalledWith(
      "ceo:legacy-session",
      expect.anything(),
    );
  });

  it.each([
    ["loading", "Starting chat…"],
    ["error", "Couldn't load chat history."],
  ])("keeps Recall usable in the %s state without an active draft", (status, stateText) => {
    mocks.chatAgent = null;
    mocks.agentStatus = status;
    render(<ChatAppLeftPanel />);

    expect(screen.getByText(stateText)).toBeInTheDocument();
    const action = mocks.setAction.mock.calls.find(
      ([key, node]) => key === "chat" && node != null,
    )?.[1] as React.ReactElement;
    render(action);
    fireEvent.click(screen.getByRole("button", { name: "Recall past chats" }));

    expect(screen.getByTestId("recall-modal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add recall to draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open recall source" }));
    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining("session=source-session"));
  });
});
