import { render, screen, waitFor } from "../../test/render";
import { Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Badge: ({ children }: { children?: React.ReactNode; variant?: string }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}));

const mockUseAuraCapabilities = vi.fn();
const mockUseProjectAgentState = vi.fn();
const mockUseRemoteAgentVm = vi.fn();
const mockHandleRuntimeAction = vi.fn(async () => {});
const mockFetchAgents = vi.fn(async () => {});
let mockAgentOwnerId = "user-1";
let mockAgentRecordAvailable = true;
const mockListSkills = vi.fn();
const mockListAgentSkills = vi.fn();
const mockInstallAgentSkill = vi.fn();
const mockUninstallAgentSkill = vi.fn();

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../apps/chat/components/ChatView/useProjectAgentState", () => ({
  useProjectAgentState: () => mockUseProjectAgentState(),
}));

vi.mock("../../apps/agents/components/AgentEnvironment/useRemoteAgentVm", () => ({
  useRemoteAgentVm: () => mockUseRemoteAgentVm(),
}));

vi.mock("../../apps/agents/stores/agent-store", () => ({
  useAgentStore: (selector: (state: {
    agents: Array<{ agent_id: string; user_id: string }>;
    agentsStatus: string;
    fetchAgents: typeof mockFetchAgents;
  }) => unknown) => selector({
    agents: mockAgentRecordAvailable ? [{ agent_id: "agent-1", user_id: mockAgentOwnerId }] : [],
    agentsStatus: "ready",
    fetchAgents: mockFetchAgents,
  }),
}));

vi.mock("../../stores/auth-store", () => ({
  useAuthStore: (selector: (state: {
    user: { user_id: string; network_user_id: string };
  }) => unknown) => selector({
    user: { user_id: "user-1", network_user_id: "network-user-1" },
  }),
}));

vi.mock("../../api/client", () => ({
  api: {
    harnessSkills: {
      listSkills: (...args: unknown[]) => mockListSkills(...args),
      listAgentSkills: (...args: unknown[]) => mockListAgentSkills(...args),
      installAgentSkill: (...args: unknown[]) => mockInstallAgentSkill(...args),
      uninstallAgentSkill: (...args: unknown[]) => mockUninstallAgentSkill(...args),
    },
  },
}));

vi.mock("../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("../../components/RemoteLogsPanel", () => ({
  RemoteLogsPanel: () => <div>VM logs</div>,
}));

vi.mock("../../apps/agents/AgentInfoPanel/agent-info-utils", () => ({
  formatAdapterLabel: () => "Codex CLI",
  formatAuthSourceLabel: () => "Managed by Aura",
  formatRunsOnLabel: () => "Isolated Cloud Runtime",
}));

vi.mock("./ProjectAgentDetailsView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectAgentDetailsView } from "./ProjectAgentDetailsView";

beforeEach(() => {
  vi.clearAllMocks();
  mockAgentOwnerId = "user-1";
  mockAgentRecordAvailable = true;
  mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
  mockUseProjectAgentState.mockReturnValue({
    selectedProjectAgent: {
      agent_instance_id: "agent-inst-1",
      agent_id: "agent-1",
      name: "Builder Bot",
      role: "Engineer",
      personality: "Helpful",
      icon: null,
      machine_type: "remote",
      environment: "swarm_microvm",
      adapter_type: "aura_harness",
      auth_source: "aura_managed",
    },
    agentDisplayName: "Builder Bot",
    contextUsagePercent: 42,
  });
  mockUseRemoteAgentVm.mockReturnValue({
    vmState: {
      state: "running",
      uptime_seconds: 4000,
      active_sessions: 2,
      endpoint: "ssh://builder-bot.remote",
    },
    remoteStateError: null,
    remoteStateRecoverable: true,
    recoveryNotice: null,
    pendingRecovery: false,
    actionLoading: null,
    actionError: null,
    handleAction: mockHandleRuntimeAction,
  });
  mockListSkills.mockResolvedValue([
    {
      name: "github",
      description: "Review and manage GitHub work",
      source: "catalog",
      model_invocable: false,
      user_invocable: true,
      frontmatter: {},
    },
    {
      name: "playwright",
      description: "Run UI checks from the browser automation toolchain",
      source: "catalog",
      model_invocable: false,
      user_invocable: true,
      frontmatter: {},
    },
  ]);
  mockListAgentSkills.mockResolvedValue([
    { agent_id: "agent-1", skill_name: "github", source_url: "https://example.com/github" },
  ]);
  mockInstallAgentSkill.mockResolvedValue({ agent_id: "agent-1", skill_name: "playwright", source_url: "https://example.com/playwright" });
  mockUninstallAgentSkill.mockResolvedValue({});
});

describe("ProjectAgentDetailsView", () => {
  it("renders the mobile project agent details surface with skills", async () => {
    render(
      <Routes>
        <Route path="/projects/:projectId/agents/:agentInstanceId/details" element={<ProjectAgentDetailsView />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/agent-inst-1/details"] } },
    );

    expect(screen.getByText("Agent Settings")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("github")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Add skills/i })).toBeInTheDocument();
  });

  it("lets mobile users manage installed and available skills", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/:agentInstanceId/details" element={<ProjectAgentDetailsView />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/agent-inst-1/details"] } },
    );

    await waitFor(() => expect(screen.getByText("github")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Add skills/i }));
    expect(screen.getByText("playwright")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Install playwright/i }));
    await waitFor(() => expect(mockInstallAgentSkill).toHaveBeenCalledWith("agent-1", "playwright"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Remove playwright/i })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Remove github/i }));
    await waitFor(() => expect(mockUninstallAgentSkill).toHaveBeenCalledWith("agent-1", "github"));
  });

  it("lets the owner control the project agent's remote runtime", async () => {
    const user = userEvent.setup();
    render(
      <Routes>
        <Route path="/projects/:projectId/agents/:agentInstanceId/details" element={<ProjectAgentDetailsView />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/agent-inst-1/details"] } },
    );

    await user.click(screen.getByRole("button", { name: /Show runtime/i }));
    expect(screen.getByText("Remote agent is running")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Hibernate/i }));
    expect(mockHandleRuntimeAction).toHaveBeenCalledWith("hibernate");
  });

  it("keeps a teammate's project agent runtime read only", async () => {
    mockAgentOwnerId = "teammate-1";
    const user = userEvent.setup();
    render(
      <Routes>
        <Route path="/projects/:projectId/agents/:agentInstanceId/details" element={<ProjectAgentDetailsView />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/agent-inst-1/details"] } },
    );

    await user.click(screen.getByRole("button", { name: /Show runtime/i }));
    expect(screen.getByText("Remote agent is running")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Remote runtime controls" })).not.toBeInTheDocument();
  });

  it("keeps controls hidden when the canonical agent owner is unavailable", async () => {
    mockAgentRecordAvailable = false;
    const user = userEvent.setup();
    render(
      <Routes>
        <Route path="/projects/:projectId/agents/:agentInstanceId/details" element={<ProjectAgentDetailsView />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/agent-inst-1/details"] } },
    );

    await user.click(screen.getByRole("button", { name: /Show runtime/i }));
    expect(screen.getByText("Remote agent is running")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Remote runtime controls" })).not.toBeInTheDocument();
    expect(mockFetchAgents).toHaveBeenCalledWith({ force: true });
  });

  it("hides project runtime controls after a non-recoverable auth error", async () => {
    mockUseRemoteAgentVm.mockReturnValue({
      vmState: {
        state: "error",
        uptime_seconds: 4000,
        active_sessions: 2,
        error_message: "Your session expired.",
      },
      remoteStateError: "Your session expired.",
      remoteStateRecoverable: false,
      recoveryNotice: null,
      pendingRecovery: false,
      actionLoading: null,
      actionError: null,
      handleAction: mockHandleRuntimeAction,
    });
    const user = userEvent.setup();
    render(
      <Routes>
        <Route path="/projects/:projectId/agents/:agentInstanceId/details" element={<ProjectAgentDetailsView />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/agent-inst-1/details"] } },
    );

    await user.click(screen.getByRole("button", { name: /Show runtime/i }));
    expect(screen.getAllByText("Your session expired.")).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Remote runtime controls" })).not.toBeInTheDocument();
  });

  it("redirects desktop layouts back to project chat", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/:agentInstanceId/details" element={<ProjectAgentDetailsView />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>Project chat destination</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/agent-inst-1/details"] } },
    );

    expect(screen.getByText("Project chat destination")).toBeInTheDocument();
  });
});
