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
const mockUseRemoteAgentState = vi.fn();
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

vi.mock("../../hooks/use-remote-agent-state", () => ({
  useRemoteAgentState: () => mockUseRemoteAgentState(),
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
  mockUseRemoteAgentState.mockReturnValue({
    data: {
      state: "running",
      uptime_seconds: 4000,
      active_sessions: 2,
      endpoint: "ssh://builder-bot.remote",
    },
    loading: false,
    error: null,
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
