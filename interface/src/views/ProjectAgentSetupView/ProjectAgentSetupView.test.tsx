import * as React from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "../../test/render";
import { CREATE_AGENT_CHAT_HANDOFF } from "../../utils/chat-handoff";

const mockUseAuraCapabilities = vi.fn();
const mockUseProjectActions = vi.fn();
const mockSetAgentsByProject = vi.fn();
const mockCreateAgent = vi.fn();
const mockCreateAgentInstance = vi.fn();
const mockListAgents = vi.fn();
const mockGetRemoteAgentState = vi.fn();
const mockSetLastAgent = vi.fn();
const mockSetLastProject = vi.fn();

const mockProjectsState = {
  projects: [
    {
      project_id: "proj-1",
      name: "Demo Project",
    },
  ],
  agentsByProject: {
    "proj-1": [],
  },
};

const mockOrgState = {
  activeOrg: {
    org_id: "org-1",
    name: "My Team",
  },
  integrations: [],
};

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick, disabled, className, variant }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button type="button" onClick={onClick} disabled={disabled} className={className} data-variant={variant}>
      {children}
    </button>
  ),
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
    <input
      ref={ref}
      {...props}
    />
  )),
  Spinner: () => <div>Loading…</div>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../apps/projects/useProjectsList", () => ({
  useProjectsList: () => ({
    setAgentsByProject: mockSetAgentsByProject,
  }),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectActions(),
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: typeof mockProjectsState) => unknown) => selector(mockProjectsState),
}));

vi.mock("../../stores/org-store", () => ({
  useOrgStore: (selector: (state: typeof mockOrgState) => unknown) => selector(mockOrgState),
}));

vi.mock("../../api/client", () => ({
  api: {
    agents: {
      list: (...args: unknown[]) => mockListAgents(...args),
      create: (...args: unknown[]) => mockCreateAgent(...args),
    },
    createAgentInstance: (...args: unknown[]) => mockCreateAgentInstance(...args),
    swarm: {
      getRemoteAgentState: (...args: unknown[]) => mockGetRemoteAgentState(...args),
    },
  },
  ApiClientError: class ApiClientError extends Error {
    status: number;
    body: { error: string; code: string; details: string | null };

    constructor(status: number, body: { error: string; code: string; details: string | null }) {
      super(body.error);
      this.status = status;
      this.body = body;
    }
  },
}));

vi.mock("../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("../../utils/storage", () => ({
  setLastAgent: (...args: unknown[]) => mockSetLastAgent(...args),
  setLastProject: (...args: unknown[]) => mockSetLastProject(...args),
}));

vi.mock("./ProjectAgentSetupView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectAgentSetupView } from "./ProjectAgentSetupView";

function LocationStateProbe() {
  const location = useLocation();
  const handoffType = (location.state as { agentChatHandoff?: { type?: string } } | null)?.agentChatHandoff?.type;
  return <div>{handoffType ?? "no-handoff"}</div>;
}

describe("ProjectAgentSetupView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
    mockUseProjectActions.mockReturnValue(null);
    mockOrgState.integrations = [];
    mockListAgents.mockResolvedValue([]);
    mockCreateAgent.mockResolvedValue({ agent_id: "agent-9" });
    mockGetRemoteAgentState.mockResolvedValue({ state: "running" });
    mockCreateAgentInstance.mockResolvedValue({
      agent_instance_id: "agent-inst-9",
      project_id: "proj-1",
      agent_id: "agent-9",
      name: "Atlas",
      role: "Engineer",
    });
  });

  it("keeps the mobile create screen focused on Aura swarm", async () => {
    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    expect(screen.getByText("Name your remote agent")).toBeInTheDocument();
    expect(screen.getByText("Managed by Aura")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Use organization connection/i })).not.toBeInTheDocument();
    expect(mockListAgents).not.toHaveBeenCalled();
  });

  it("submits an Aura-managed swarm create payload", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>Agent chat</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Role"), "Engineer");
    await user.click(screen.getByRole("button", { name: "Create Agent" }));

    await waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        org_id: "org-1",
        name: "Atlas",
        role: "Engineer",
        machine_type: "remote",
        adapter_type: "aura_harness",
        environment: "swarm_microvm",
        auth_source: "aura_managed",
        integration_id: null,
      }));
    });
  });

  it("navigates to the new chat with a create handoff flag", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<LocationStateProbe />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Role"), "Engineer");
    await user.click(screen.getByRole("button", { name: "Create Agent" }));

    await waitFor(() => {
      expect(screen.getByText(CREATE_AGENT_CHAT_HANDOFF)).toBeInTheDocument();
    });
  });

  it("persists the created agent as the current project agent before handing off to chat", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>Agent chat</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Role"), "Engineer");
    await user.click(screen.getByRole("button", { name: "Create Agent" }));

    await waitFor(() => {
      expect(mockSetLastProject).toHaveBeenCalledWith("proj-1");
      expect(mockSetLastAgent).toHaveBeenCalledWith("proj-1", "agent-inst-9");
    });
  });

  it("waits for the remote agent to be ready before navigating to chat", async () => {
    const user = userEvent.setup();
    let resolveRemoteState: ((value: { state: string }) => void) | null = null;
    mockGetRemoteAgentState.mockReturnValue(new Promise((resolve) => {
      resolveRemoteState = resolve;
    }));

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<LocationStateProbe />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Role"), "Engineer");
    await user.click(screen.getByRole("button", { name: "Create Agent" }));

    await waitFor(() => {
      expect(mockGetRemoteAgentState).toHaveBeenCalledWith("agent-9");
    });
    expect(screen.queryByText(CREATE_AGENT_CHAT_HANDOFF)).not.toBeInTheDocument();
    expect(mockCreateAgentInstance).not.toHaveBeenCalled();

    resolveRemoteState?.({ state: "running" });

    await waitFor(() => {
      expect(mockCreateAgentInstance).toHaveBeenCalledWith("proj-1", "agent-9");
      expect(screen.getByText(CREATE_AGENT_CHAT_HANDOFF)).toBeInTheDocument();
    });
  });

  it("submits from the role field when mobile users press Enter", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>Agent chat</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("Role"), "Engineer");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        name: "Atlas",
        role: "Engineer",
      }));
    });
  });

  it("reveals and focuses the role field when mobile users continue from name", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    const nameInput = screen.getByLabelText("Name");
    expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();

    await user.click(nameInput);
    await user.type(nameInput, "Atlas{Enter}");

    await waitFor(() => {
      const roleInput = screen.getByLabelText("Role");
      expect(roleInput).toBeInTheDocument();
      expect(roleInput).toHaveFocus();
    });
  });

  it("lets mobile users edit the name after moving to the role step", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    const nameInput = screen.getByLabelText("Name");

    await user.type(nameInput, "Atlas");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Atlas")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.queryByLabelText("Role")).not.toBeInTheDocument();
  });

  it("keeps the role step focused on the summary card and role field", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Role")).toBeInTheDocument();
    expect(screen.getByText("Agent name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("blocks mobile create when the name contains spaces", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.type(screen.getByLabelText("Name"), "Atlas Scout");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Use only letters, numbers, hyphens, or underscores")).toBeInTheDocument();
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it("does not surface attach-existing loading errors on the create flow", async () => {
    mockListAgents.mockRejectedValue(new Error("Load failed"));

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await waitFor(() => {
      expect(screen.queryByText("Load failed")).not.toBeInTheDocument();
    });
    expect(mockListAgents).not.toHaveBeenCalled();
  });

  it("limits attach-existing candidates to remote agents in the active org", async () => {
    mockListAgents.mockResolvedValue([
      {
        agent_id: "agent-1",
        org_id: "org-1",
        name: "Local teammate",
        role: "Engineer",
        machine_type: "local",
      },
      {
        agent_id: "agent-2",
        org_id: "org-2",
        name: "Foreign remote",
        role: "Analyst",
        machine_type: "remote",
      },
      {
        agent_id: "agent-3",
        org_id: "org-1",
        name: "Org remote",
        role: "Researcher",
        machine_type: "remote",
      },
    ]);

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/existing" element={<ProjectAgentSetupView mode="existing" />} />
        <Route path="/projects/:projectId/agents/create" element={<div>Create fallback</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/existing"] } },
    );

    expect(await screen.findByRole("button", { name: /Org remote/i })).toBeInTheDocument();
    expect(screen.queryByText("Foreign remote")).not.toBeInTheDocument();
    expect(screen.queryByText("Local teammate")).not.toBeInTheDocument();
  });
});
