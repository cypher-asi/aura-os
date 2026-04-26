import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { InitialEntry } from "@remix-run/router";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@cypher-asi/zui", () => ({
  Topbar: ({ title, actions, icon }: { title?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; className?: string }) => (
    <header data-testid="topbar">{icon}{title}{actions}</header>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
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
  Button: ({ children, onClick, icon, ...rest }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      aria-label={rest["aria-label"] as string}
      disabled={rest.disabled as boolean}
    >
      {icon as React.ReactNode}{children as React.ReactNode}
    </button>
  ),
  ButtonPlus: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>+</button>,
  Drawer: ({ children, isOpen, title }: { children?: React.ReactNode; isOpen: boolean; title: string; onClose?: () => void; side?: string; className?: string; showMinimizedBar?: boolean; defaultSize?: number; maxSize?: number }) =>
    isOpen ? <div data-testid={`drawer-${title || "untitled"}`}>{children}</div> : null,
}));

const mockActiveApp = {
  id: "projects",
  label: "Projects",
  basePath: "/projects",
  MainPanel: ({ children }: { children?: React.ReactNode }) => <div data-testid="main-panel">{children}</div>,
  ResponsiveControls: undefined as React.ComponentType | undefined,
  PreviewPanel: undefined as React.ComponentType | undefined,
  PreviewHeader: undefined as React.ComponentType | undefined,
};

const demoProject = {
  project_id: "proj-1",
  org_id: "org-1",
  name: "Demo Project",
  description: "Test project",
  current_status: "active",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};
const projectAgentFixtures = [
  { agent_instance_id: "agent-inst-1", name: "Project agent", role: "Build with me" },
] as Array<{ agent_instance_id: string; name: string; role?: string }>;
const openNewProjectModal = vi.fn();

const orgFixtures = [
  { org_id: "org-1", name: "Alpha Team", owner_user_id: "u1", billing: null, created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z" },
  { org_id: "org-2", name: "Beta Team", owner_user_id: "u1", billing: null, created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z" },
] as const;
const switchOrg = vi.fn();
const createOrg = vi.fn(async (name: string) => ({
  org_id: "org-new",
  name,
  owner_user_id: "u1",
  billing: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
}));
const mockOrgErrors = {
  orgsError: null as string | null,
  membersError: null as string | null,
  integrationsError: null as string | null,
};
const mockProjectsError = {
  value: null as string | null,
};
const mockSetLastProject = vi.fn();

vi.mock("../../stores/app-store", () => ({
  useAppStore: (sel: (s: { activeApp: typeof mockActiveApp }) => unknown) =>
    sel({ activeApp: mockActiveApp }),
  resolveActiveApp: () => mockActiveApp,
}));

const drawers = {
  navOpen: false,
  appOpen: false,
  previewOpen: false,
  accountOpen: false,
  setNavOpen: vi.fn(),
  setAppOpen: vi.fn(),
  setPreviewOpen: vi.fn(),
  setAccountOpen: vi.fn(),
  closeDrawers: vi.fn(),
  openAfterDrawerClose: vi.fn((cb: () => void) => cb()),
};

vi.mock("../../stores/mobile-drawer-store", () => ({
  useMobileDrawerStore: (sel: (s: typeof drawers) => unknown) => sel(drawers),
  selectDrawerOpen: (s: typeof drawers) => s.navOpen || s.appOpen || s.previewOpen || s.accountOpen,
  selectOverlayDrawerOpen: (s: typeof drawers) => s.navOpen || s.appOpen || s.previewOpen || s.accountOpen,
}));

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: (selector?: (state: {
    openOrgSettings: ReturnType<typeof vi.fn>;
    openHostSettings: ReturnType<typeof vi.fn>;
  }) => unknown) => {
    const state = {
      openOrgSettings: vi.fn(),
      openHostSettings: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../../stores/org-store", () => ({
  useOrgStore: (selector: (state: {
    orgs: typeof orgFixtures;
    activeOrg: typeof orgFixtures[number];
    orgsError: string | null;
    membersError: string | null;
    integrationsError: string | null;
    switchOrg: typeof switchOrg;
    createOrg: typeof createOrg;
    refreshOrgs: () => Promise<void>;
  }) => unknown) => selector({
    orgs: orgFixtures,
    activeOrg: orgFixtures[0],
    orgsError: mockOrgErrors.orgsError,
    membersError: mockOrgErrors.membersError,
    integrationsError: mockOrgErrors.integrationsError,
    switchOrg,
    createOrg,
    refreshOrgs: async () => undefined,
  }),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => null,
}));

vi.mock("../../api/client", () => ({
  api: {
    listProjects: vi.fn(async () => [demoProject]),
  },
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    isMobileClient: true,
    isPhoneLayout: true,
    isMobileLayout: true,
    features: {
      hostRetargeting: true,
    },
  }),
}));

vi.mock("../../hooks/use-mobile-drawers", () => ({
  useMobileDrawerEffects: vi.fn(),
}));

vi.mock("../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => ({ query: "", setQuery: vi.fn() }),
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: {
    projects: typeof demoProject[];
    projectsError: string | null;
    agentsByProject: Record<string, Array<{ agent_instance_id: string; name: string; role?: string }>>;
    loadingAgentsByProject: Record<string, boolean>;
    openNewProjectModal: () => void;
    refreshProjects: () => Promise<void>;
    refreshProjectAgents: (projectId: string) => Promise<Array<{ agent_instance_id: string; name: string; role?: string }>>;
  }) => unknown) => selector({
    projects: [demoProject],
    projectsError: mockProjectsError.value,
    agentsByProject: {
      "proj-1": projectAgentFixtures,
    },
    loadingAgentsByProject: {},
    openNewProjectModal,
    refreshProjects: async () => undefined,
    refreshProjectAgents: async () => projectAgentFixtures,
  }),
  getRecentProjects: (projects: typeof demoProject[]) => projects,
  getMostRecentProject: (projects: typeof demoProject[]) => projects[0] ?? null,
}));

vi.mock("../../apps/process/stores/process-store", () => ({
  useProcessStore: (selector: (state: {
    processes: Array<{ process_id: string; project_id?: string | null; enabled: boolean }>;
    loading: boolean;
    fetchProcesses: () => Promise<void>;
  }) => unknown) => selector({
    processes: [{ process_id: "proc-1", project_id: "proj-1", enabled: true }],
    loading: false,
    fetchProcesses: async () => undefined,
  }),
}));

vi.mock("../../utils/storage", () => ({
  getLastProject: () => null,
  getLastAgentEntry: () => null,
  getLastAgent: () => "agent-inst-1",
  setLastProject: (...args: unknown[]) => mockSetLastProject(...args),
}));

vi.mock("../../utils/mobileNavigation", () => ({
  getMobileProjectDestination: (pathname: string) => {
    if (pathname.includes("/work")) return "execution";
    if (pathname.includes("/tasks")) return "tasks";
    if (pathname.includes("/process")) return "process";
    if (pathname.includes("/files")) return "files";
    if (pathname.includes("/stats")) return "stats";
    if (pathname.includes("/agent")) return "agent";
    if (pathname.includes("/agents/")) return "agent";
    return null;
  },
  getMobileShellMode: (pathname: string) => (pathname.startsWith("/projects/proj-1") ? "project" : "global"),
  getProjectIdFromPathname: (pathname: string) => (pathname.startsWith("/projects/proj-1") ? "proj-1" : null),
  getProjectAgentInstanceIdFromPathname: (pathname: string) => pathname.match(/\/agents\/([^/]+)/)?.[1] ?? null,
  isProjectSubroute: (pathname: string) => pathname.startsWith("/projects/proj-1/"),
  projectAgentRoute: (id: string) => `/projects/${id}/agent`,
  projectAgentsRoute: (id: string) => `/projects/${id}/agents`,
  projectAgentChatRoute: (projectId: string, agentInstanceId: string) => `/projects/${projectId}/agents/${agentInstanceId}`,
  projectAgentDetailsRoute: (projectId: string, agentInstanceId: string) => `/projects/${projectId}/agents/${agentInstanceId}/details`,
  projectFilesRoute: (id: string) => `/projects/${id}/files`,
  projectProcessRoute: (id: string) => `/projects/${id}/process`,
  projectStatsRoute: (id: string) => `/projects/${id}/stats`,
  projectTasksRoute: (id: string) => `/projects/${id}/tasks`,
  projectRootPath: (id: string) => `/projects/${id}`,
  projectWorkRoute: (id: string) => `/projects/${id}/work`,
}));

vi.mock("../ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../ProjectList", () => ({
  ProjectList: () => <div data-testid="project-list" />,
}));
vi.mock("../UpdateBanner", () => ({
  UpdateBanner: () => <div data-testid="update-banner" />,
}));
vi.mock("../PanelSearch", () => ({
  PanelSearch: () => <div data-testid="panel-search" />,
}));
vi.mock("../HostSettingsModal", () => ({
  HostSettingsModal: () => null,
}));
vi.mock("../../shared/lib/host-config", () => ({
  getHostDisplayLabel: () => "https://bad-host.example",
}));
vi.mock("../../apps/agents/MobileAgentLibraryView", () => ({
  MobileAgentLibraryView: () => <div data-testid="mobile-agent-library-view" />,
}));
vi.mock("../../apps/agents/MobileAgentDetailsView", () => ({
  MobileAgentDetailsView: () => <div data-testid="mobile-agent-details-view" />,
}));
vi.mock("../../apps/profile/ProfileMainPanel", () => ({
  ProfileMainPanel: () => <div>Profile settings destination</div>,
}));
vi.mock("../../apps/feed/FeedMainPanel", () => ({
  FeedMainPanel: () => <div>Feed settings destination</div>,
}));
vi.mock("../../apps/feedback/FeedbackMainPanel", () => ({
  FeedbackMainPanel: () => <div>Feedback settings destination</div>,
}));
const mockSidekickState = { closePreview: vi.fn() };
type SidekickState = typeof mockSidekickState;
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: SidekickState) => unknown) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("./MobileShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { MobileShell } from "../MobileShell";

function renderMobile(path: InitialEntry | InitialEntry[] = "/projects") {
  const initialEntries = Array.isArray(path) ? path : [path];
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<MobileShell />}>
          <Route path="/projects/organization" element={<div>Organization workspace</div>} />
          <Route path="/projects/:projectId/agent" element={<div>Project agent redirect</div>} />
          <Route path="/projects/:projectId/agents" element={<div>Project agents roster</div>} />
          <Route path="/projects/:projectId/agents/create" element={<div>Create remote agent</div>} />
          <Route path="/projects/:projectId/agents/attach" element={<div>Attach remote agent</div>} />
          <Route path="/projects/:projectId/agents/:agentInstanceId/details" element={<div>Project agent details</div>} />
          <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>Project agent chat</div>} />
          <Route path="/projects/:projectId/tasks" element={<div>Project tasks</div>} />
          <Route path="/projects/:projectId/work" element={<div>Project work</div>} />
          <Route path="/projects/:projectId/files" element={<div>Project files</div>} />
          <Route path="/projects/:projectId/process" element={<div>Project process</div>} />
          <Route path="/projects/:projectId/stats" element={<div>Project stats</div>} />
          <Route path="/projects/settings" element={<div>Settings route</div>} />
          <Route path="/agents" element={<div>Agents</div>} />
          <Route path="/agents/:agentId" element={<div>Agent details</div>} />
          <Route path="/feed" element={<div>Feed</div>} />
          <Route path="/projects" element={<div>Projects</div>} />
          <Route path="*" element={<div>Fallback</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  drawers.navOpen = false;
  drawers.appOpen = false;
  drawers.previewOpen = false;
  drawers.accountOpen = false;
  mockActiveApp.PreviewPanel = undefined;
  mockActiveApp.ResponsiveControls = undefined;
  mockOrgErrors.orgsError = null;
  mockOrgErrors.membersError = null;
  mockOrgErrors.integrationsError = null;
  mockProjectsError.value = null;
  projectAgentFixtures.splice(0, projectAgentFixtures.length, { agent_instance_id: "agent-inst-1", name: "Project agent", role: "Build with me" });
});

describe("MobileShell", () => {
  it("renders the main panel", () => {
    renderMobile();
    expect(screen.getByTestId("main-panel")).toBeInTheDocument();
  });

  it("renders project tabs with files included", () => {
    renderMobile("/projects/proj-1/agent");
    expect(screen.getByRole("button", { name: "Open project navigation for Demo Project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: true, name: /Agents/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: false, name: /Files/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: false, name: /Tasks/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: false, name: /Run/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: false, name: /More/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Process/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Stats/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Feed")).not.toBeInTheDocument();
  });

  it("keeps the project title trigger in the top bar on the agent route", () => {
    renderMobile("/projects/proj-1/agents/agent-inst-1");
    expect(screen.getByRole("button", { name: "Open project navigation for Demo Project" })).toBeInTheDocument();
  });

  it("keeps project drawers free of nested back navigation", async () => {
    const user = userEvent.setup();
    drawers.navOpen = true;
    renderMobile("/projects/proj-1/work");

    expect(screen.queryByRole("button", { name: "Back to project" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(drawers.closeDrawers).toHaveBeenCalledOnce();
  });

  it("renders the global navigation trigger on global routes", () => {
    renderMobile("/feed");
    expect(screen.getByRole("button", { name: "Open project navigation" })).toBeInTheDocument();
  });

  it("omits the workspace/settings action from project chrome", () => {
    renderMobile();
    expect(screen.queryByRole("button", { name: "Open workspace" })).not.toBeInTheDocument();
  });

  it("shows a back button on standalone mobile agent details routes", () => {
    mockActiveApp.id = "agents";
    mockActiveApp.label = "Agents";
    renderMobile("/agents/agent-1");

    expect(screen.getByRole("button", { name: "Back to agent library" })).toBeInTheDocument();
  });

  it("shows create action on the standalone mobile agent library route", () => {
    mockActiveApp.id = "agents";
    mockActiveApp.label = "Agents";
    renderMobile("/agents");

    expect(screen.getByRole("button", { name: "Create Remote Agent" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open workspace" })).not.toBeInTheDocument();
  });

  it("hides the extra main panel on the standalone mobile agent library root", () => {
    mockActiveApp.id = "agents";
    mockActiveApp.label = "Agents";

    renderMobile("/agents");

    expect(screen.getByTestId("mobile-agent-library-view")).toBeInTheDocument();
    expect(screen.queryByTestId("main-panel")).not.toBeInTheDocument();
  });

  it("renders the standalone mobile agent details wrapper", () => {
    mockActiveApp.id = "agents";
    mockActiveApp.label = "Agents";

    renderMobile("/agents/agent-1");

    expect(screen.getByTestId("mobile-agent-details-view")).toBeInTheDocument();
    expect(screen.queryByTestId("main-panel")).not.toBeInTheDocument();
  });

  it("keeps organization workspace reachable as a route without project topbar chrome", async () => {
    renderMobile("/projects/organization");

    expect(await screen.findByText("Organization workspace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open workspace" })).not.toBeInTheDocument();
  });

  it("shows a direct back-to-project action on the workspace route", async () => {
    const user = userEvent.setup();
    renderMobile([{ pathname: "/projects/organization", state: { returnTo: "/projects/proj-1/files" } }]);

    expect(screen.getByRole("button", { name: "Back to project" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to project" }));

    expect(await screen.findByText("Project files")).toBeInTheDocument();
  });

  it("opens settings with a return path to the current mobile screen", async () => {
    const user = userEvent.setup();
    renderMobile("/projects/proj-1/files");

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(await screen.findByText("Settings route")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to previous screen" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to previous screen" }));

    expect(await screen.findByText("Project files")).toBeInTheDocument();
  });

  it("renders update banner", () => {
    renderMobile();
    expect(screen.getByTestId("update-banner")).toBeInTheDocument();
  });

  it("keeps add-project-agent actions out of the chat top bar", () => {
    renderMobile("/projects/proj-1/agents/agent-inst-1");

    expect(screen.queryByRole("button", { name: "Add project agent" })).not.toBeInTheDocument();
  });

  it("surfaces a mobile warning when live workspace data failed to load", () => {
    mockOrgErrors.orgsError = "Unexpected token '<'";

    renderMobile("/projects/proj-1/agent");

    expect(screen.getByText("Live workspace data could not load.")).toBeInTheDocument();
    expect(screen.getByText(/saved device data/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Host settings" })).toBeInTheDocument();
  });

  it("navigates the mobile agent tab back to the agents roster", async () => {
    const user = userEvent.setup();
    renderMobile("/projects/proj-1/work");

    await user.click(screen.getByRole("button", { name: /agents/i }));

    expect(await screen.findByText("Project agents roster")).toBeInTheDocument();
  });

  it("hides project tabs when a drawer is open", () => {
    drawers.navOpen = true;
    renderMobile("/projects/proj-1/agent");
    expect(screen.queryByRole("navigation", { name: "Project sections" })).not.toBeInTheDocument();
  });

  it("hides project tabs on the attach-existing route", () => {
    renderMobile("/projects/proj-1/agents/attach");
    expect(screen.queryByRole("navigation", { name: "Project sections" })).not.toBeInTheDocument();
  });

  it("keeps project drawer focused on switching agents and projects", () => {
    drawers.navOpen = true;
    renderMobile("/projects/proj-1/work");

    expect(screen.getByText("AURA")).toBeInTheDocument();
    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
    expect(screen.queryByText("Current project")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent & skills")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open details for project agent/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Recent projects")).not.toBeInTheDocument();
    expect(screen.queryByText("Other projects")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alpha Team/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Demo Project/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agents" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tasks" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execution" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Process" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stats" })).not.toBeInTheDocument();
  });

  it("omits the project agent switcher when only one agent is attached", () => {
    drawers.navOpen = true;
    renderMobile("/projects/proj-1/work");

    expect(screen.queryByRole("button", { name: /project agent/i })).not.toBeInTheDocument();
  });

  it("shows overlay backdrop when drawer is open", () => {
    drawers.navOpen = true;
    renderMobile();
    expect(screen.getByRole("button", { name: "Close drawer" })).toBeInTheDocument();
  });

  it("pushes settings destinations inside the mobile settings sheet with a back affordance", async () => {
    drawers.accountOpen = true;
    const user = userEvent.setup();

    renderMobile("/projects/proj-1/agents");

    await user.click(screen.getByRole("button", { name: /Profile/ }));

    expect(await screen.findByText("Profile settings destination")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Settings" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to Settings" }));

    expect(screen.getByRole("button", { name: /Leaderboard/ })).toBeInTheDocument();
    expect(screen.queryByText("Profile settings destination")).not.toBeInTheDocument();
  });

  it("calls closeDrawers when backdrop is clicked", async () => {
    drawers.navOpen = true;
    const user = userEvent.setup();
    renderMobile();

    await user.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(drawers.closeDrawers).toHaveBeenCalledOnce();
  });

  it("uses the backdrop as the primary project drawer close action", async () => {
    drawers.navOpen = true;
    const user = userEvent.setup();
    renderMobile("/projects/proj-1/work");

    expect(within(screen.getByTestId("project-navigation-drawer")).getAllByText("Demo Project")[0]).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(drawers.closeDrawers).toHaveBeenCalledOnce();
  });

  it("keeps the project drawer focused on projects even when multiple agents are attached", () => {
    drawers.navOpen = true;
    projectAgentFixtures.splice(
      0,
      projectAgentFixtures.length,
      { agent_instance_id: "agent-inst-1", name: "Project agent", role: "Build with me" },
      { agent_instance_id: "agent-inst-2", name: "Research agent", role: "Investigate with me" },
    );

    renderMobile("/projects/proj-1/work");

    expect(screen.queryByText("Agents")).not.toBeInTheDocument();
    expect(screen.queryByText("Research agent")).not.toBeInTheDocument();
    expect(screen.getByText("AURA")).toBeInTheDocument();
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
  });
});
