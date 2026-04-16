import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const switchOrg = vi.fn();
const refreshProjects = vi.fn();
const refreshProjectAgents = vi.fn(async () => []);
const openNewProjectModal = vi.fn();
const createOrg = vi.fn(async (name: string) => ({
  org_id: "org-3",
  name,
  owner_user_id: "u1",
  billing: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
}));
const openOrgSettings = vi.fn();
const openHostSettings = vi.fn();
const openSettings = vi.fn();

const orgs = [
  {
    org_id: "org-1",
    name: "Alpha Team",
    owner_user_id: "u1",
    billing: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
  {
    org_id: "org-2",
    name: "Beta Team",
    owner_user_id: "u1",
    billing: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  },
];

const projects = [
  {
    project_id: "project-1",
    org_id: "org-1",
    name: "Mobile Runtime",
    description: "Keep the remote swarm moving from mobile.",
    current_status: "active",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-03T00:00:00Z",
  },
  {
    project_id: "project-2",
    org_id: "org-1",
    name: "Release Readiness",
    description: "QA the mobile release.",
    current_status: "planning",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-02T00:00:00Z",
  },
];

const agentsByProject = {
  "project-1": [
    {
      agent_instance_id: "agent-1",
      project_id: "project-1",
      agent_id: "template-1",
      name: "Navigator",
      role: "release lead",
      personality: "",
      system_prompt: "",
      skills: [],
      icon: null,
      machine_type: "remote",
      adapter_type: "cloud",
      environment: "remote",
      status: "idle",
      current_task_id: null,
      current_session_id: null,
      total_input_tokens: 0,
      total_output_tokens: 0,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-03T00:00:00Z",
    },
  ],
  "project-2": [],
};

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick, icon, ...rest }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} aria-label={rest["aria-label"] as string}>
      {icon as React.ReactNode}
      {children as React.ReactNode}
    </button>
  ),
  Input: ({ value, onChange, placeholder, onKeyDown }: Record<string, unknown>) => (
    <input
      value={value as string}
      onChange={onChange as React.ChangeEventHandler<HTMLInputElement>}
      placeholder={placeholder as string}
      onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLInputElement>}
    />
  ),
  Modal: ({ children, isOpen, title, footer }: { children?: React.ReactNode; isOpen: boolean; title?: string; footer?: React.ReactNode }) => (
    isOpen ? <div data-testid={`modal-${title ?? "unnamed"}`}>{children}{footer}</div> : null
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../stores/projects-list-store", () => ({
  getRecentProjects: (items: typeof projects) => [...items]
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
  useProjectsListStore: (selector: (state: {
    projects: typeof projects;
    agentsByProject: typeof agentsByProject;
    loadingProjects: boolean;
    refreshProjects: typeof refreshProjects;
    refreshProjectAgents: typeof refreshProjectAgents;
    openNewProjectModal: typeof openNewProjectModal;
  }) => unknown) => selector({
    projects,
    agentsByProject,
    loadingProjects: false,
    refreshProjects,
    refreshProjectAgents,
    openNewProjectModal,
  }),
}));

vi.mock("../../stores/org-store", () => ({
  useOrgStore: (selector: (state: {
    orgs: typeof orgs;
    activeOrg: typeof orgs[number];
    switchOrg: typeof switchOrg;
    createOrg: typeof createOrg;
  }) => unknown) => selector({
    orgs,
    activeOrg: orgs[0],
    switchOrg,
    createOrg,
  }),
}));

vi.mock("../../utils/storage", () => ({
  getLastAgent: (projectId: string) => (projectId === "project-1" ? "agent-1" : null),
  getLastAgentEntry: () => ({ projectId: "project-1", agentInstanceId: "agent-1" }),
  getLastProject: () => "project-1",
}));

vi.mock("../../hooks/use-modal-initial-focus", () => ({
  useModalInitialFocus: () => ({
    inputRef: { current: null },
    initialFocusRef: { current: null },
    autoFocus: false,
  }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    features: {
      hostRetargeting: true,
    },
  }),
}));

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: (selector: (state: {
    openOrgSettings: typeof openOrgSettings;
    openHostSettings: typeof openHostSettings;
    openSettings: typeof openSettings;
  }) => unknown) => selector({
    openOrgSettings,
    openHostSettings,
    openSettings,
  }),
}));

import { MobileOrganizationView } from "./MobileOrganizationView";

function renderView() {
  return render(
    <MemoryRouter initialEntries={["/projects/organization"]}>
      <Routes>
        <Route path="/projects/organization" element={<MobileOrganizationView />} />
        <Route path="/projects" element={<div>projects-route</div>} />
        <Route path="/projects/:projectId/agent" element={<div>project-agent-route</div>} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>project-agent-chat-route</div>} />
        <Route path="/projects/:projectId/tasks" element={<div>project-tasks-route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MobileOrganizationView", () => {
  it("renders a resume-work card for the active org and opens the remembered agent chat", async () => {
    const user = userEvent.setup();
    renderView();

    expect(screen.getByRole("button", { name: "Chat with Navigator" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chat with Navigator" }));

    expect(await screen.findByText("project-agent-chat-route")).toBeInTheDocument();
  });

  it("opens recent project tasks from the resume card secondary action", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: "Tasks" }));

    expect(await screen.findByText("project-tasks-route")).toBeInTheDocument();
  });

  it("switches orgs and returns to projects", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByText("Beta Team"));

    expect(switchOrg).toHaveBeenCalledWith(orgs[1]);
    expect(await screen.findByText("projects-route")).toBeInTheDocument();
  });

  it("opens team settings from the action list", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: "Team settings" }));

    expect(openOrgSettings).toHaveBeenCalledOnce();
  });

  it("creates a new team from the dedicated mobile organization screen", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole("button", { name: "New Team" }));
    await user.type(screen.getByPlaceholderText("Team name"), "Fresh Team");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(createOrg).toHaveBeenCalledWith("Fresh Team");
    expect(switchOrg).toHaveBeenCalledWith("org-3");
    expect(await screen.findByText("projects-route")).toBeInTheDocument();
  });
});
