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
  Input: ({ "aria-label": ariaLabel, value, onChange, placeholder, name, autoComplete }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      name={name}
      autoComplete={autoComplete}
    />
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
  useOrgStore: (selector: (state: typeof mockOrgState) => unknown) => selector(mockOrgState),
}));

vi.mock("../../api/client", () => ({
  api: {
    agents: {
      list: (...args: unknown[]) => mockListAgents(...args),
      create: (...args: unknown[]) => mockCreateAgent(...args),
    },
    createAgentInstance: (...args: unknown[]) => mockCreateAgentInstance(...args),
  },
}));

vi.mock("../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
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

    expect(screen.getByText("Create Aura Swarm Agent")).toBeInTheDocument();
    expect(screen.getByText("Aura-managed billing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use organization connection/i })).not.toBeInTheDocument();
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
    await user.type(screen.getByLabelText("Role"), "Engineer");
    await user.click(screen.getByRole("button", { name: "Create & Add Agent" }));

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
    await user.type(screen.getByLabelText("Role"), "Engineer");
    await user.click(screen.getByRole("button", { name: "Create & Add Agent" }));

    await waitFor(() => {
      expect(screen.getByText(CREATE_AGENT_CHAT_HANDOFF)).toBeInTheDocument();
    });
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
    await user.click(screen.getByRole("button", { name: "Create & Add Agent" }));

    expect(screen.getByText("Use only letters, numbers, hyphens, or underscores")).toBeInTheDocument();
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });
});
