import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@cypher-asi/zui", () => ({
  Topbar: ({ title, actions, icon }: { title?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; className?: string }) => (
    <header data-testid="topbar">{icon}{title}{actions}</header>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
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
    isOpen ? <div data-testid={`drawer-${title}`}>{children}</div> : null,
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
  name: "Demo Project",
  description: "Test project",
};

vi.mock("../../stores/app-store", () => ({
  useAppStore: (sel: (s: { activeApp: typeof mockActiveApp }) => unknown) =>
    sel({ activeApp: mockActiveApp }),
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
  useUIModalStore: () => ({
    openOrgSettings: vi.fn(),
    openSettings: vi.fn(),
  }),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => null,
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    isPhoneLayout: true,
    isMobileLayout: true,
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
    agentsByProject: Record<string, Array<{ agent_instance_id: string; name: string; role?: string }>>;
    loadingAgentsByProject: Record<string, boolean>;
    openNewProjectModal: () => void;
    refreshProjectAgents: (projectId: string) => Promise<Array<{ agent_instance_id: string; name: string; role?: string }>>;
  }) => unknown) => selector({
    projects: [demoProject],
    agentsByProject: {
      "proj-1": [{ agent_instance_id: "agent-inst-1", name: "Project agent", role: "Build with me" }],
    },
    loadingAgentsByProject: {},
    openNewProjectModal: vi.fn(),
    refreshProjectAgents: async () => [{ agent_instance_id: "agent-inst-1", name: "Project agent", role: "Build with me" }],
  }),
  getRecentProjects: (projects: typeof demoProject[]) => projects,
  getMostRecentProject: (projects: typeof demoProject[]) => projects[0] ?? null,
}));

vi.mock("../../utils/storage", () => ({
  getLastProject: () => null,
  getLastAgentEntry: () => null,
  getLastAgent: () => "agent-inst-1",
}));

vi.mock("../../utils/mobileNavigation", () => ({
  getMobileProjectDestination: (pathname: string) => {
    if (pathname.includes("/work")) return "tasks";
    if (pathname.includes("/files")) return "files";
    if (pathname.includes("/stats")) return "stats";
    if (pathname.includes("/agent")) return "agent";
    if (pathname.includes("/agents/")) return "agent";
    return null;
  },
  getMobileShellMode: (pathname: string) => (pathname.startsWith("/projects/proj-1") ? "project" : "global"),
  getProjectIdFromPathname: (pathname: string) => (pathname.startsWith("/projects/proj-1") ? "proj-1" : null),
  isProjectSubroute: (pathname: string) => pathname.startsWith("/projects/proj-1/"),
  projectAgentRoute: (id: string) => `/projects/${id}/agent`,
  projectAgentChatRoute: (projectId: string, agentInstanceId: string) => `/projects/${projectId}/agents/${agentInstanceId}`,
  projectFilesRoute: (id: string) => `/projects/${id}/files`,
  projectStatsRoute: (id: string) => `/projects/${id}/stats`,
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
vi.mock("../../apps/agents/MobileAgentLibraryView", () => ({
  MobileAgentLibraryView: () => <div data-testid="mobile-agent-library-view" />,
}));
vi.mock("../../apps/agents/MobileAgentDetailsView", () => ({
  MobileAgentDetailsView: () => <div data-testid="mobile-agent-details-view" />,
}));
const mockSidekickState = { closePreview: vi.fn() };
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("./MobileShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { MobileShell } from "../MobileShell";

function renderMobile(path = "/projects") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<MobileShell />}>
          <Route path="/projects/:projectId/agent" element={<div>Project agent redirect</div>} />
          <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>Project agent chat</div>} />
          <Route path="/projects/:projectId/work" element={<div>Project work</div>} />
          <Route path="/projects/:projectId/stats" element={<div>Project stats</div>} />
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
});

describe("MobileShell", () => {
  it("renders the main panel", () => {
    renderMobile();
    expect(screen.getByTestId("main-panel")).toBeInTheDocument();
  });

  it("renders project bottom navigation with 4 items", () => {
    renderMobile("/projects/proj-1/agent");
    expect(screen.getByRole("button", { name: "Open project navigation for Demo Project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: true, name: /Agent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: false, name: /Execution/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { pressed: false, name: /Stats/i })).toBeInTheDocument();
    expect(screen.queryByText("Feed")).not.toBeInTheDocument();
    expect(screen.queryByText("Files")).not.toBeInTheDocument();
  });

  it("keeps the project title trigger in the top bar on the agent route", () => {
    renderMobile("/projects/proj-1/agents/agent-inst-1");
    expect(screen.getByRole("button", { name: "Open project navigation for Demo Project" })).toBeInTheDocument();
  });

  it("renders the global navigation trigger on global routes", () => {
    renderMobile("/feed");
    expect(screen.getByRole("button", { name: "Open apps" })).toBeInTheDocument();
  });

  it("renders account button", () => {
    renderMobile();
    expect(screen.getByRole("button", { name: "Open account" })).toBeInTheDocument();
  });

  it("shows a back button on standalone mobile agent details routes", () => {
    mockActiveApp.id = "agents";
    mockActiveApp.label = "Agents";
    renderMobile("/agents/agent-1");

    expect(screen.getByRole("button", { name: "Back to agent library" })).toBeInTheDocument();
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

  it("opens account drawer when account button clicked", async () => {
    const user = userEvent.setup();
    renderMobile();

    await user.click(screen.getByRole("button", { name: "Open account" }));
    expect(drawers.setAccountOpen).toHaveBeenCalledWith(true);
  });

  it("renders update banner", () => {
    renderMobile();
    expect(screen.getByTestId("update-banner")).toBeInTheDocument();
  });

  it("navigates the mobile agent tab back to the last agent chat", async () => {
    const user = userEvent.setup();
    renderMobile("/projects/proj-1/work");

    await user.click(screen.getByRole("button", { name: /agent/i }));

    expect(await screen.findByText("Project agent chat")).toBeInTheDocument();
  });

  it("hides bottom nav when a drawer is open", () => {
    drawers.navOpen = true;
    renderMobile("/projects/proj-1/agent");
    expect(screen.queryByRole("navigation", { name: "Primary mobile navigation" })).not.toBeInTheDocument();
  });

  it("shows overlay backdrop when drawer is open", () => {
    drawers.navOpen = true;
    renderMobile();
    expect(screen.getByRole("button", { name: "Close drawer" })).toBeInTheDocument();
  });

  it("calls closeDrawers when backdrop is clicked", async () => {
    drawers.navOpen = true;
    const user = userEvent.setup();
    renderMobile();

    await user.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(drawers.closeDrawers).toHaveBeenCalledOnce();
  });
});
