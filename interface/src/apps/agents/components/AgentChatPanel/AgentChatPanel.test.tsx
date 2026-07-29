import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentChatPanel } from "./AgentChatPanel";

const mockUseAuraCapabilities = vi.fn();
const mockUseTerminalTarget = vi.fn();
const mockUseChatStream = vi.fn();
const mockChatPanelProps = vi.fn();
const mockRegisterRemoteAgents = vi.fn();
const mockGetSafeWorkspaceEligibility = vi.fn();
let mockRemoteStatus: string | undefined = "running";
let mockMachineType: "local" | "remote" = "remote";

vi.mock("../../../../api/client", () => ({
  api: {
    getEvents: vi.fn(),
    listSessionEventsPaginated: vi.fn(),
    getContextUsage: vi.fn(),
    getContextContents: vi.fn(),
    getSafeWorkspaceEligibility: (...args: unknown[]) =>
      mockGetSafeWorkspaceEligibility(...args),
    stopLoop: vi.fn(),
  },
}));

vi.mock("../../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => mockUseTerminalTarget(),
}));

vi.mock("../../../../hooks/use-chat-stream", () => ({
  useChatStream: (...args: unknown[]) => mockUseChatStream(...args),
}));

vi.mock("../../../../hooks/use-chat-history-sync", () => ({
  useChatHistorySync: () => ({
    historyMessages: [],
    historyResolved: true,
    isLoading: false,
    historyError: null,
    wrapSend: (send: unknown) => send,
  }),
}));

vi.mock("../../../../hooks/use-agent-chat-meta", () => ({
  useAgentChatMeta: () => ({
    agentName: "Remote Agent",
    machineType: mockMachineType,
    templateAgentId: "template-agent-1",
    adapterType: "aura",
    defaultModel: "aura-gpt-5-4",
  }),
}));

vi.mock("../../../../hooks/use-prior-sessions", () => ({
  usePriorSessions: () => ({
    priorEvents: [],
    loadPriorSession: vi.fn(),
    hasPriorSession: false,
    isLoadingPriorSession: false,
    sessionBoundaries: [],
  }),
}));

vi.mock("../../../../hooks/use-load-older-messages", () => ({
  buildProjectSessionHistoryFetch: vi.fn(),
}));

vi.mock("../../../../hooks/use-hydrate-context-utilization", () => ({
  useHydrateContextUtilization: vi.fn(),
}));

vi.mock("../../../../hooks/use-agent-busy", () => ({
  useAgentBusy: () => ({ isBusy: false, reason: null }),
}));

vi.mock("../../../../shared/hooks/use-delayed-loading", () => ({
  useDelayedLoading: (value: boolean) => value,
}));

vi.mock("../../../../stores/context-usage-store", () => ({
  useContextUsage: () => null,
}));

vi.mock("../../../../stores/profile-status-store", () => ({
  useProfileStatusStore: (selector: (state: {
    statuses: Record<string, string>;
    registerRemoteAgents: typeof mockRegisterRemoteAgents;
  }) => unknown) =>
    selector({
      statuses: mockRemoteStatus
        ? { "template-agent-1": mockRemoteStatus }
        : {},
      registerRemoteAgents: mockRegisterRemoteAgents,
    }),
}));

vi.mock("../../../../stores/chat-history-store", () => ({
  projectChatHistoryKey: (projectId: string, agentInstanceId: string) =>
    `project:${projectId}:${agentInstanceId}`,
  sessionHistoryKey: (projectId: string, agentInstanceId: string, sessionId: string) =>
    `session:${projectId}:${agentInstanceId}:${sessionId}`,
}));

vi.mock("../../../../stores/sessions-list-store", () => ({
  projectSessionsSurfaceKey: (projectId: string) => `project:${projectId}`,
  useSessionsListStore: (selector: (state: { loadProjectSessions: () => void }) => unknown) =>
    selector({ loadProjectSessions: vi.fn() }),
}));

vi.mock("../../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: {
    projects: Array<{ project_id: string; name: string }>;
    agentsByProject: Record<string, Array<{ agent_instance_id: string; agent_id: string }>>;
  }) => unknown) =>
    selector({
      projects: [{ project_id: "project-1", name: "Project One" }],
      agentsByProject: {
        "project-1": [{ agent_instance_id: "agent-inst-1", agent_id: "template-agent-1" }],
      },
    }),
}));

vi.mock("../../../../utils/storage", () => ({
  setLastAgent: vi.fn(),
  setLastProject: vi.fn(),
}));

vi.mock("../../hooks/use-fresh-canvas", () => ({
  useFreshCanvas: () => ({
    freshCanvasPending: false,
    freshChatNonce: 0,
    newChat: vi.fn(),
  }),
}));

vi.mock("../../hooks/use-optimistic-session-row", () => ({
  useOptimisticSessionRow: () => ({
    swap: vi.fn(),
    arm: vi.fn(),
    wrap: (send: unknown) => send,
  }),
}));

vi.mock("../../hooks/use-auto-rename-from-prompt", () => ({
  useAutoRenameFromPrompt: () => vi.fn(),
}));

vi.mock("../../hooks/use-new-session-url-sync", () => ({
  useNewSessionUrlSync: () => vi.fn(),
}));

vi.mock("../../../chat/components/ChatPanel", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    mockChatPanelProps(props);
    return <div data-testid="chat-panel" />;
  },
}));

vi.mock("../../../../mobile/chat/MobileChatPanel", () => ({
  MobileChatPanel: () => <div data-testid="mobile-chat-panel" />,
}));

vi.mock("../ProjectAgentSwitcher", () => ({
  ProjectAgentSwitcher: () => null,
}));

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/projects/project-1/agents/agent-inst-1"]}>
      <AgentChatPanel
        projectId="project-1"
        agentInstanceId="agent-inst-1"
        sessionId={null}
        initialCreateHandoff={false}
      />
    </MemoryRouter>,
  );
}

describe("AgentChatPanel workspace automation target", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoteStatus = "running";
    mockMachineType = "remote";
    mockGetSafeWorkspaceEligibility.mockResolvedValue({ available: true });
    mockUseAuraCapabilities.mockReturnValue({
      features: { linkedWorkspace: false },
      hasDesktopBridge: false,
      hostedSafeWorkspace: false,
      isMobileLayout: false,
      remoteOnly: false,
    });
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: "remote-template-1",
      remoteAgentInstanceId: undefined,
      remoteWorkspacePath: "/workspace/project",
      workspacePath: "/Users/demo/project",
      status: "ready",
    });
    mockUseChatStream.mockReturnValue({
      streamKey: "stream-key",
      sendMessage: vi.fn(),
      stopStreaming: vi.fn(),
      resetEvents: vi.fn(),
      markNextSendAsNewSession: vi.fn(),
    });
  });

  it("does not enable dev-loop chat bridging for browse-only remote workspaces", () => {
    renderPanel();

    expect(mockUseChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceToolsEnabled: false,
        workspaceStartAgentInstanceId: undefined,
      }),
    );
  });

  it("pins dev-loop chat bridging to the remote project-agent instance when available", () => {
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: "remote-template-1",
      remoteAgentInstanceId: "remote-inst-1",
      remoteWorkspacePath: "/workspace/project",
      workspacePath: "/Users/demo/project",
      status: "ready",
    });

    renderPanel();

    expect(mockUseChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceToolsEnabled: true,
        workspaceStartAgentInstanceId: "remote-inst-1",
      }),
    );
  });

  it("keeps local desktop dev-loop chat bridging enabled without a remote instance id", () => {
    mockMachineType = "local";
    mockUseAuraCapabilities.mockReturnValue({
      features: { linkedWorkspace: true },
      hasDesktopBridge: true,
      hostedSafeWorkspace: false,
      isMobileLayout: false,
      remoteOnly: false,
    });
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: "/Users/demo/project",
      status: "ready",
    });

    renderPanel();

    expect(mockUseChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceToolsEnabled: true,
        workspaceStartAgentInstanceId: undefined,
      }),
    );
  });

  it("shows Safe Workspace only for an eligible desktop-owned local workspace", async () => {
    mockMachineType = "local";
    mockUseAuraCapabilities.mockReturnValue({
      features: { linkedWorkspace: true },
      hasDesktopBridge: true,
      hostedSafeWorkspace: false,
      isMobileLayout: false,
      remoteOnly: false,
    });

    renderPanel();

    await waitFor(() => {
      expect(mockChatPanelProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ header: expect.anything() }),
      );
    });
  });

  it("hides Safe Workspace when the linked desktop folder is not Git-backed", async () => {
    mockMachineType = "local";
    mockUseAuraCapabilities.mockReturnValue({
      features: { linkedWorkspace: true },
      hasDesktopBridge: true,
      hostedSafeWorkspace: false,
      isMobileLayout: false,
      remoteOnly: false,
    });
    mockGetSafeWorkspaceEligibility.mockResolvedValue({ available: false });

    renderPanel();

    await waitFor(() => {
      expect(mockGetSafeWorkspaceEligibility).toHaveBeenCalledWith(
        "project-1",
        "agent-inst-1",
      );
    });
    expect(mockChatPanelProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ header: undefined }),
    );
  });

  it("hides Safe Workspace for a web local agent backed by the hosted harness", () => {
    mockMachineType = "local";
    mockUseAuraCapabilities.mockReturnValue({
      features: { linkedWorkspace: false },
      hasDesktopBridge: false,
      hostedLocalHarness: true,
      hostedSafeWorkspace: false,
      isMobileLayout: false,
      remoteOnly: false,
    });

    renderPanel();

    expect(mockChatPanelProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ header: undefined }),
    );
  });

  it("shows Safe Workspace after the hosted harness advertises support", async () => {
    mockMachineType = "local";
    mockUseAuraCapabilities.mockReturnValue({
      features: { linkedWorkspace: false },
      hasDesktopBridge: false,
      hostedLocalHarness: true,
      hostedSafeWorkspace: true,
      isMobileLayout: false,
      remoteOnly: false,
    });

    renderPanel();

    await waitFor(() => {
      expect(mockChatPanelProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ header: expect.anything() }),
      );
    });
  });

  it("keeps Safe Workspace hidden for remote agents even when hosted support is available", () => {
    mockMachineType = "remote";
    mockUseAuraCapabilities.mockReturnValue({
      features: { linkedWorkspace: false },
      hasDesktopBridge: false,
      hostedLocalHarness: true,
      hostedSafeWorkspace: true,
      isMobileLayout: false,
      remoteOnly: false,
    });

    renderPanel();

    expect(mockChatPanelProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ header: undefined }),
    );
  });

  it("blocks chat immediately when the remote agent is offline", () => {
    mockRemoteStatus = "stopped";

    renderPanel();

    expect(mockChatPanelProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sendDisabled: true,
        sendDisabledReason:
          "This remote agent is offline. Start it before sending a message.",
      }),
    );
  });

  it("registers the current remote agent for live availability updates", () => {
    renderPanel();

    expect(mockRegisterRemoteAgents).toHaveBeenCalledWith([
      { agent_id: "template-agent-1" },
    ]);
  });
});
