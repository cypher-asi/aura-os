import { Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "../../test/render";

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

  it("keeps the primary mobile create screen focused while still exposing the org integration path", async () => {
    mockOrgState.integrations = [
      {
        integration_id: "int-anthropic",
        org_id: "org-1",
        name: "Shared Anthropic",
        provider: "anthropic",
        kind: "workspace_connection",
        has_secret: true,
        enabled: true,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ];

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    expect(screen.getByText("Create Remote Agent")).toBeInTheDocument();
    expect(screen.getByText("Managed by Aura")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Use organization connection/i })).toBeInTheDocument();
    expect(screen.queryByText("Organization integration")).not.toBeInTheDocument();
  });

  it("submits an org integration backed remote create payload", async () => {
    const user = userEvent.setup();
    mockOrgState.integrations = [
      {
        integration_id: "int-anthropic",
        org_id: "org-1",
        name: "Shared Anthropic",
        provider: "anthropic",
        kind: "workspace_connection",
        has_secret: true,
        enabled: true,
        created_at: "2026-03-17T01:00:00.000Z",
        updated_at: "2026-03-17T01:00:00.000Z",
      },
    ];

    render(
      <Routes>
        <Route path="/projects/:projectId/agents/create" element={<ProjectAgentSetupView mode="create" />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>Agent chat</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents/create"] } },
    );

    await user.type(screen.getByLabelText("Name"), "Atlas");
    await user.type(screen.getByLabelText("Role"), "Engineer");
    await user.click(screen.getByRole("button", { name: /Use organization connection/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Shared Anthropic/i })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /Shared Anthropic/i }));
    await user.click(screen.getByRole("button", { name: "Create & Add Agent" }));

    await waitFor(() => {
      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        org_id: "org-1",
        name: "Atlas",
        role: "Engineer",
        machine_type: "remote",
        adapter_type: "aura_harness",
        environment: "swarm_microvm",
        auth_source: "org_integration",
        integration_id: "int-anthropic",
      }));
    });
  });
});
