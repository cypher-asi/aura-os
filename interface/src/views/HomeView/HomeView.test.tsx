import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import type { Project } from "../../shared/types";

const orgState = {
  activeOrg: { id: "org-1" },
  isLoading: false,
  orgs: [{ id: "org-1" }],
};

const projectsState = {
  projects: [] as Project[],
  loadingProjects: false,
  refreshProjects: vi.fn(),
};

const storageState = {
  lastProject: null as string | null,
  lastAgentEntry: null as { projectId: string; agentInstanceId: string } | null,
  lastAgentByProject: {} as Record<string, string>,
};

const mockGetMostRecentProject = vi.fn<(projects: Project[]) => Project | null>();

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  PageEmptyState: ({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) => (
    <div data-testid="page-empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {actions}
    </div>
  ),
}));

vi.mock("../../stores/org-store", () => ({
  useOrgStore: (selector: (state: typeof orgState) => unknown) => selector(orgState),
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: typeof projectsState) => unknown) => selector(projectsState),
  getMostRecentProject: (projects: Project[]) => mockGetMostRecentProject(projects),
}));

const setAccountOpen = vi.fn();

vi.mock("../../stores/mobile-drawer-store", () => ({
  useMobileDrawerStore: (selector: (state: { setAccountOpen: typeof setAccountOpen }) => unknown) =>
    selector({ setAccountOpen }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isMobileLayout: true }),
}));

vi.mock("../../utils/storage", () => ({
  getLastProject: () => storageState.lastProject,
  getLastAgentEntry: () => storageState.lastAgentEntry,
  getLastAgent: (projectId: string) => storageState.lastAgentByProject[projectId] ?? null,
}));

import { HomeView } from "./HomeView";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    project_id: "p1",
    org_id: "org-1",
    name: "Project One",
    description: "",
    current_status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Project;
}

function ProjectAgentRouteTarget() {
  const { projectId } = useParams<{ projectId: string }>();
  return <div>{`project-agent:${projectId}`}</div>;
}

function ProjectAgentChatTarget() {
  const { projectId, agentInstanceId } = useParams<{
    projectId: string;
    agentInstanceId: string;
  }>();
  return <div>{`project-chat:${projectId}:${agentInstanceId}`}</div>;
}

function renderHomeView() {
  return render(
    <MemoryRouter initialEntries={["/projects"]}>
      <Routes>
        <Route path="/projects" element={<HomeView />} />
        <Route path="/projects/organization" element={<div>organization-route</div>} />
        <Route path="/projects/:projectId/agent" element={<ProjectAgentRouteTarget />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<ProjectAgentChatTarget />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  orgState.activeOrg = { id: "org-1" };
  orgState.isLoading = false;
  orgState.orgs = [{ id: "org-1" }];
  projectsState.projects = [];
  projectsState.loadingProjects = false;
  projectsState.refreshProjects.mockReset();
  storageState.lastProject = null;
  storageState.lastAgentEntry = null;
  storageState.lastAgentByProject = {};
  setAccountOpen.mockReset();
  mockGetMostRecentProject.mockReset();
  mockGetMostRecentProject.mockReturnValue(null);
});

describe("HomeView", () => {
  it("redirects to the remembered project agent when one is stored", () => {
    projectsState.projects = [
      makeProject({ project_id: "p1", name: "Alpha" }),
      makeProject({ project_id: "p2", name: "Beta" }),
    ];
    storageState.lastProject = "p2";
    storageState.lastAgentByProject = { p2: "agent-9" };

    renderHomeView();

    expect(screen.getByText("project-chat:p2:agent-9")).toBeInTheDocument();
  });

  it("redirects to the project agent resolver when a project is resolved without a remembered agent", () => {
    const recentProject = makeProject({ project_id: "p2", name: "Beta" });
    projectsState.projects = [
      makeProject({ project_id: "p1", name: "Alpha" }),
      recentProject,
    ];
    mockGetMostRecentProject.mockReturnValue(recentProject);

    renderHomeView();

    expect(screen.getByText("project-agent:p2")).toBeInTheDocument();
  });

  it("renders the welcome empty state when no projects can be resolved", () => {
    renderHomeView();

    expect(screen.getByTestId("page-empty-state")).toBeInTheDocument();
    expect(screen.getByText("Welcome to AURA")).toBeInTheDocument();
    expect(screen.getByText("Select a project from navigation to get started.")).toBeInTheDocument();
  });

  it("waits for project hydration before rendering the welcome empty state", () => {
    projectsState.loadingProjects = true;

    renderHomeView();

    expect(screen.queryByTestId("page-empty-state")).not.toBeInTheDocument();
  });

  it("retries loading projects when an org is active but no projects are ready yet", () => {
    renderHomeView();

    expect(projectsState.refreshProjects).toHaveBeenCalledOnce();
  });

  it("routes mobile first-run CTA to the dedicated organization screen", async () => {
    const user = userEvent.setup();
    orgState.activeOrg = null;
    orgState.orgs = [];

    renderHomeView();

    await user.click(screen.getByRole("button", { name: "Set Up Team" }));

    expect(screen.getByText("organization-route")).toBeInTheDocument();
  });
});
