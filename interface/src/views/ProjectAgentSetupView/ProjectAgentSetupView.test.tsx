import * as React from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "../../test/render";
import { CREATE_AGENT_CHAT_HANDOFF } from "../../utils/chat-handoff";

const mockUseAuraCapabilities = vi.fn();
const mockUseProjectActions = vi.fn();
const mockUseOrgStore = vi.fn();
const mockSetAgentsByProject = vi.fn();
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
  } as Record<string, Array<Record<string, unknown>>>,
};

const mockAgentEditorModal = vi.fn((props: {
  onSaved: (agent: { agent_id: string }) => void | Promise<void>;
  onClose: () => void;
  titleOverride?: string;
  agent?: { agent_id: string };
  mobilePresentation?: "sheet" | "inline";
  submitLabelOverride?: string;
  showCloseAction?: boolean;
}) => (
  <div data-testid="agent-editor-modal">
    <div>{props.titleOverride ?? "Create Agent"}</div>
    {props.mobilePresentation ? <div>Presentation {props.mobilePresentation}</div> : null}
    {props.submitLabelOverride ? <div>{props.submitLabelOverride}</div> : null}
    <div>{props.showCloseAction === false ? "Close hidden" : "Close visible"}</div>
    {props.agent ? <div>Retrying {props.agent.agent_id}</div> : null}
    <button type="button" onClick={() => { void props.onSaved({ agent_id: "agent-9" }).catch(() => {}); }}>
      Trigger shared save
    </button>
    <button type="button" onClick={props.onClose}>
      Close shared editor
    </button>
  </div>
));

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick, disabled, className, variant }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button type="button" onClick={onClick} disabled={disabled} className={className} data-variant={variant}>
      {children}
    </button>
  ),
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
  useOrgStore: (selector: (state: {
    activeOrg: { org_id: string; name: string } | null;
    isLoading: boolean;
    orgsError: string | null;
  }) => unknown) => selector(mockUseOrgStore()),
}));

vi.mock("../../api/client", () => ({
  api: {
    agents: {
      list: (...args: unknown[]) => mockListAgents(...args),
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

vi.mock("../../apps/agents/components/AgentEditorModal", () => ({
  AgentEditorModal: (props: Parameters<typeof mockAgentEditorModal>[0]) => mockAgentEditorModal(props),
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
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isMobileClient: true });
    mockUseProjectActions.mockReturnValue(null);
    mockUseOrgStore.mockReturnValue({
      activeOrg: {
        org_id: "org-1",
        name: "My Team",
      },
      isLoading: false,
      orgsError: null,
    });
    mockProjectsState.agentsByProject["proj-1"] = [];
    mockListAgents.mockResolvedValue([]);
    mockGetRemoteAgentState.mockResolvedValue({ state: "running" });
    mockCreateAgentInstance.mockResolvedValue({
      agent_instance_id: "agent-inst-9",
      project_id: "proj-1",
      agent_id: "agent-9",
      name: "Atlas",
      role: "Engineer",
    });
  });

  it("uses the shared editor on the mobile create route", () => {
    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>Attached after retry</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    expect(screen.getAllByText("Create Remote Agent").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Attach Existing Agent" })).toBeInTheDocument();
    expect(screen.getByText("Create a fresh agent for this project, or attach one your team already shares.")).toBeInTheDocument();
    expect(screen.getByTestId("agent-editor-modal")).toBeInTheDocument();
    expect(mockAgentEditorModal.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      closeOnSave: false,
      forceRemoteOnlyCreate: true,
      mobilePresentation: "inline",
      showCloseAction: false,
    }));
    expect(mockListAgents).not.toHaveBeenCalled();
  });

  it("attaches a newly saved shared-editor agent and navigates to chat with handoff state", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<LocationStateProbe />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.click(screen.getByRole("button", { name: "Trigger shared save" }));

    await waitFor(() => {
      expect(mockGetRemoteAgentState).toHaveBeenCalledWith("agent-9");
      expect(mockCreateAgentInstance).toHaveBeenCalledWith("proj-1", "agent-9");
      expect(screen.getByText(CREATE_AGENT_CHAT_HANDOFF)).toBeInTheDocument();
    });
    expect(mockSetLastProject).toHaveBeenCalledWith("proj-1");
    expect(mockSetLastAgent).toHaveBeenCalledWith("proj-1", "agent-inst-9");
  });

  it("retries attach against the already-created agent after a post-save failure", async () => {
    const user = userEvent.setup();
    mockCreateAgentInstance
      .mockRejectedValueOnce(new Error("Attach failed"))
      .mockResolvedValueOnce({
        agent_instance_id: "agent-inst-9",
        project_id: "proj-1",
        agent_id: "agent-9",
        name: "Atlas",
        role: "Engineer",
      });

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>Attached after retry</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.click(screen.getByRole("button", { name: "Trigger shared save" }));

    await waitFor(() => {
      expect(screen.getByText("Retrying agent-9")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Trigger shared save" }));

    await waitFor(() => {
      expect(mockCreateAgentInstance).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Attached after retry")).toBeInTheDocument();
    });
  });

  it("lets users jump from create to attach without a hidden route", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/attach" element={<div>Attach route</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.click(screen.getByRole("button", { name: "Attach Existing Agent" }));

    expect(await screen.findByText("Attach route")).toBeInTheDocument();
  });

  it("returns to the project agent route when the shared editor closes", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents" element={<div>Project agent landing</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.click(screen.getByRole("button", { name: "Close shared editor" }));

    expect(await screen.findByText("Project agent landing")).toBeInTheDocument();
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
        <Route path="/projects/:projectId/agents/attach" element={<ProjectAgentSetupView mode="existing" />} />
        <Route path="/projects/:projectId/agents/create" element={<div>Create fallback</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/attach"] } },
    );

    expect(await screen.findByRole("button", { name: /Org remote/i })).toBeInTheDocument();
    expect(screen.queryByText("Foreign remote")).not.toBeInTheDocument();
    expect(screen.queryByText("Local teammate")).not.toBeInTheDocument();
  });

  it("stays on attach and shows an error when existing agents fail to load", async () => {
    mockListAgents.mockRejectedValue(new Error("Agent list failed"));

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/attach" element={<ProjectAgentSetupView mode="existing" />} />
        <Route path="/projects/:projectId/agents/create" element={<div>Create fallback</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/attach"] } },
    );

    expect(await screen.findByText("Add Existing Agent")).toBeInTheDocument();
    expect(await screen.findByText("Agent list failed")).toBeInTheDocument();
    expect(screen.queryByText("Create fallback")).not.toBeInTheDocument();
  });

  it("stays on attach while the active org is still resolving", async () => {
    mockUseOrgStore.mockReturnValue({
      activeOrg: null,
      isLoading: true,
      orgsError: null,
    });

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/attach" element={<ProjectAgentSetupView mode="existing" />} />
        <Route path="/projects/:projectId/agents/create" element={<div>Create fallback</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/attach"] } },
    );

    expect(await screen.findByText("Add Existing Agent")).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Create fallback")).not.toBeInTheDocument();
    expect(mockListAgents).not.toHaveBeenCalled();
  });

  it("redirects desktop users back to the project root", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true, isMobileClient: false });

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId" element={<div>Desktop project root</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    expect(screen.getByText("Desktop project root")).toBeInTheDocument();
  });
});
