import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ChatAppRoute } from "./ChatAppRoute";

type FakeAgent = { agent_id: string; name: string };
type FakeSession = {
  session_id: string;
  _projectId: string;
  _agentInstanceId: string;
  _agentId?: string;
  started_at: string;
};

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  setSearchParams: vi.fn(),
  chatAgent: { agent_id: "ceo", name: "CEO" } as FakeAgent | null,
  agentStatus: "ready" as "loading" | "ready" | "error",
  agents: [] as FakeAgent[],
  setSelectedAgent: vi.fn(),
  isMobileLayout: false,
  remoteOnly: false,
  bindingsByAgent: {} as Record<
    string,
    { project_agent_id: string; project_id: string; project_name: string }[]
  >,
  sessions: [] as FakeSession[],
  useChatAppChat: vi.fn(() => ({ streamKey: "chat-stream" })),
  setLastChatRoute: vi.fn(),
  pendingQuickPrompt: null as { agentId: string; text: string } | null,
  takeForAgent: vi.fn(),
  setDraft: vi.fn(),
  drafts: {} as Record<string, string>,
}));

vi.mock("react-router-dom", () => ({
  useSearchParams: () => [mocks.searchParams, mocks.setSearchParams],
}));

vi.mock("@cypher-asi/zui", () => ({
  PageEmptyState: (props: Record<string, unknown>) => (
    <div data-testid="page-empty-state" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("../../../chat/components/ChatPanel", () => ({
  ChatPanel: (props: Record<string, unknown>) => (
    <div data-testid="chat-panel" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("../../../../mobile/chat/MobileChatPanel", () => ({
  MobileChatPanel: (props: Record<string, unknown>) => (
    <div data-testid="mobile-chat-panel" data-props={JSON.stringify(props)} />
  ),
}));

vi.mock("../../../agents/stores", () => ({
  useAgents: () => ({ agents: mocks.agents }),
  useSelectedAgent: () => ({ setSelectedAgent: mocks.setSelectedAgent }),
}));

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    isMobileLayout: mocks.isMobileLayout,
    remoteOnly: mocks.remoteOnly,
  }),
}));

vi.mock("../../../../stores/sessions-list-store", () => ({
  useSessionsListStore: (
    selector: (state: { bindingsByAgent: typeof mocks.bindingsByAgent }) => unknown,
  ) => selector({ bindingsByAgent: mocks.bindingsByAgent }),
}));

vi.mock("../../hooks/use-chat-app-agent", () => ({
  useChatAppAgent: (options?: { remoteOnly?: boolean }) => ({
    agent: mocks.chatAgent,
    status: mocks.agentStatus,
    error: null,
    options,
  }),
}));

vi.mock("../../hooks/use-chat-app-chat", () => ({
  useChatAppChat: (...args: unknown[]) => mocks.useChatAppChat(...args),
}));

vi.mock("../../hooks/use-chat-app-sessions", () => ({
  useChatAppSessions: () => ({ sessions: mocks.sessions, loading: false }),
}));

vi.mock("../../hooks/use-public-chat-import", () => ({
  useImportPublicChatsOnAuth: vi.fn(),
}));

vi.mock("../../../../utils/storage", () => ({
  setLastChatRoute: (...args: unknown[]) => mocks.setLastChatRoute(...args),
}));

vi.mock("../../../../stores/quick-prompt-store", () => {
  const useQuickPromptStore = Object.assign(
    (selector: (state: { pendingPrompt: typeof mocks.pendingQuickPrompt }) => unknown) =>
      selector({ pendingPrompt: mocks.pendingQuickPrompt }),
    {
      getState: () => ({ takeForAgent: mocks.takeForAgent }),
    },
  );
  return {
    useQuickPromptStore,
    mergeQuickPromptDraft: (existing: string, incoming: string) =>
      existing ? `${existing}\n\n${incoming}` : incoming,
  };
});

vi.mock("../../../../stores/chat-ui-store", () => ({
  useChatUIStore: {
    getState: () => ({ drafts: mocks.drafts, setDraft: mocks.setDraft }),
  },
}));

describe("ChatAppRoute", () => {
  beforeEach(() => {
    mocks.searchParams = new URLSearchParams();
    mocks.chatAgent = { agent_id: "ceo", name: "CEO" };
    mocks.agentStatus = "ready";
    mocks.agents = [];
    mocks.bindingsByAgent = {};
    mocks.sessions = [];
    mocks.setSelectedAgent.mockReset();
    mocks.setSearchParams.mockReset();
    mocks.setLastChatRoute.mockReset();
    mocks.useChatAppChat.mockReset();
    mocks.useChatAppChat.mockReturnValue({ streamKey: "chat-stream" });
    mocks.pendingQuickPrompt = null;
    mocks.takeForAgent.mockReset();
    mocks.setDraft.mockReset();
    mocks.drafts = {};
    mocks.remoteOnly = false;
  });

  // Regression: after the aura-storage migration 0015 deploy,
  // `/api/me/sessions` returns sessions owned by every agent the user
  // has -- including agents outside the active org, which are absent
  // from the org-scoped `useAgents()` list. `ChatAppLeftPanel` writes
  // `?agent=<true owner>` from the row's `_agentId`, but the route
  // used to resolve the chat fetch off the cached `Agent` object and
  // fell back to the CEO chat agent on a miss, 404ing the per-session
  // events read ("session not found"). The fetch must use the URL
  // agent id verbatim.
  it("drives the chat fetch with the URL agent id even when it isn't in the active-org agents list", () => {
    mocks.searchParams = new URLSearchParams(
      "agent=out-of-org-agent&project=p1&instance=i1&session=s1",
    );
    mocks.agents = []; // active org does not surface the owning agent

    render(<ChatAppRoute />);

    expect(mocks.useChatAppChat).toHaveBeenCalledWith(
      "out-of-org-agent",
      "s1",
      expect.objectContaining({ freshCanvasPending: false }),
    );
    expect(mocks.setSelectedAgent).toHaveBeenCalledWith("out-of-org-agent");
  });

  it("prefers the URL agent id over the resolved Agent object when both are present", () => {
    mocks.searchParams = new URLSearchParams(
      "agent=agent-2&project=p1&instance=i1&session=s1",
    );
    mocks.agents = [{ agent_id: "agent-2", name: "Agent Two" }];

    render(<ChatAppRoute />);

    expect(mocks.useChatAppChat).toHaveBeenCalledWith("agent-2", "s1", {
      freshCanvasPending: false,
    });
  });

  it("remembers concrete chat session routes for later taskbar returns", () => {
    mocks.searchParams = new URLSearchParams(
      "agent=agent-2&project=p1&instance=i1&session=s1",
    );

    render(<ChatAppRoute />);

    expect(mocks.setLastChatRoute).toHaveBeenCalledWith(
      "/chat?agent=agent-2&project=p1&instance=i1&session=s1",
    );
  });

  it("does not remember no-agent session routes before the session owner loads", () => {
    mocks.searchParams = new URLSearchParams("project=p1&instance=i1&session=s1");

    render(<ChatAppRoute />);

    expect(mocks.setLastChatRoute).not.toHaveBeenCalled();
  });

  it("remembers no-agent session routes once the session owner loads", () => {
    mocks.searchParams = new URLSearchParams("project=p1&instance=i1&session=s1");
    const { rerender } = render(<ChatAppRoute />);
    expect(mocks.setLastChatRoute).not.toHaveBeenCalled();

    mocks.sessions = [
      {
        session_id: "s1",
        _projectId: "p1",
        _agentInstanceId: "i1",
        _agentId: "agent-2",
        started_at: new Date().toISOString(),
      },
    ];
    rerender(<ChatAppRoute />);

    expect(mocks.setLastChatRoute).toHaveBeenCalledWith(
      "/chat?project=p1&instance=i1&session=s1&agent=agent-2",
    );
  });

  it("derives a share-capable remembered route for legacy session-only links", () => {
    mocks.searchParams = new URLSearchParams("session=s1");
    mocks.sessions = [
      {
        session_id: "s1",
        _projectId: "p1",
        _agentInstanceId: "i1",
        _agentId: "agent-2",
        started_at: new Date().toISOString(),
      },
    ];

    render(<ChatAppRoute />);

    expect(mocks.setLastChatRoute).toHaveBeenCalledWith(
      "/chat?session=s1&project=p1&instance=i1&agent=agent-2",
    );
  });

  it("does not remember fresh chat canvases as last session routes", () => {
    mocks.searchParams = new URLSearchParams("fresh=abc");

    render(<ChatAppRoute />);

    expect(mocks.setLastChatRoute).not.toHaveBeenCalled();
  });

  it("falls back to the CEO chat agent for the fresh-canvas (no params) form", () => {
    mocks.searchParams = new URLSearchParams();

    render(<ChatAppRoute />);

    expect(mocks.useChatAppChat).toHaveBeenCalledWith("ceo", null, {
      freshCanvasPending: true,
    });
  });

  it("places a Quick Prompt handoff into the active Chat app composer", () => {
    mocks.searchParams = new URLSearchParams(
      "agent=agent-2&project=p1&instance=i1&session=s1",
    );
    mocks.pendingQuickPrompt = {
      agentId: "agent-2",
      text: "Review this before sending",
    };
    mocks.takeForAgent.mockReturnValue("Review this before sending");
    mocks.drafts = { "chat-stream": "Existing draft" };

    render(<ChatAppRoute />);

    expect(mocks.takeForAgent).toHaveBeenCalledWith("agent-2");
    expect(mocks.setDraft).toHaveBeenCalledWith(
      "chat-stream",
      "Existing draft\n\nReview this before sending",
    );
  });

  it("asks the chat-agent resolver for a web-safe agent on remote-only clients", () => {
    mocks.remoteOnly = true;
    mocks.searchParams = new URLSearchParams();

    render(<ChatAppRoute />);

    expect(mocks.useChatAppChat).toHaveBeenCalledWith("ceo", null, {
      freshCanvasPending: true,
    });
  });

  it("treats the fresh route flag as an empty chat canvas", () => {
    mocks.searchParams = new URLSearchParams("fresh=abc");

    render(<ChatAppRoute />);

    expect(mocks.useChatAppChat).toHaveBeenCalledWith("ceo", null, {
      freshCanvasPending: true,
      freshCanvasKey: "abc",
    });
  });

  it("does not infer a fresh route from sessions materializing in the global list", () => {
    mocks.searchParams = new URLSearchParams("fresh=abc");
    const { rerender } = render(<ChatAppRoute />);

    mocks.sessions = [
      {
        session_id: "private-second-opinion-reference",
        _projectId: "p-reference",
        _agentInstanceId: "i-reference",
        _agentId: "reference-agent",
        started_at: new Date().toISOString(),
      },
      {
        session_id: "other-tab-session",
        _projectId: "p-other",
        _agentInstanceId: "i-other",
        _agentId: "other-agent",
        started_at: new Date().toISOString(),
      },
    ];
    rerender(<ChatAppRoute />);

    expect(mocks.setSearchParams).not.toHaveBeenCalled();
  });

  it("does not adopt a fresh route before the active chat sends", () => {
    mocks.searchParams = new URLSearchParams("fresh=abc");
    const { rerender } = render(<ChatAppRoute />);

    mocks.sessions = [
      {
        session_id: "s-existing",
        _projectId: "p-existing",
        _agentInstanceId: "i-existing",
        _agentId: "ceo",
        started_at: new Date().toISOString(),
      },
    ];
    rerender(<ChatAppRoute />);

    expect(mocks.setSearchParams).not.toHaveBeenCalled();
  });

  it("disables send instead of silently dropping cold-start sends before setup resolves", () => {
    mocks.searchParams = new URLSearchParams();
    mocks.chatAgent = null;
    mocks.agentStatus = "loading";

    render(<ChatAppRoute />);

    expect(mocks.useChatAppChat).toHaveBeenCalledWith(undefined, null, {
      freshCanvasPending: true,
    });
    const props = JSON.parse(
      screen.getByTestId("chat-panel").getAttribute("data-props") ?? "{}",
    );
    expect(props.sendDisabled).toBe(true);
    expect(props.sendDisabledReason).toBe("Starting chat...");
  });
});
