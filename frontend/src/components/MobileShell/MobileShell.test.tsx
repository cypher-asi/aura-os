import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@cypher-asi/zui", () => ({
  Topbar: ({ title, actions, icon }: { title?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode; className?: string }) => (
    <header data-testid="topbar">{icon}{title}{actions}</header>
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

vi.mock("../../stores/app-store", () => ({
  useAppStore: (sel: (s: { activeApp: typeof mockActiveApp }) => unknown) =>
    sel({ activeApp: mockActiveApp }),
}));

const drawers = {
  navOpen: false,
  previewOpen: false,
  accountOpen: false,
  setNavOpen: vi.fn(),
  setPreviewOpen: vi.fn(),
  setAccountOpen: vi.fn(),
  closeDrawers: vi.fn(),
  openAfterDrawerClose: vi.fn((cb: () => void) => cb()),
};

vi.mock("../../stores/mobile-drawer-store", () => ({
  useMobileDrawerStore: (sel: (s: typeof drawers) => unknown) => sel(drawers),
  selectDrawerOpen: (s: typeof drawers) => s.navOpen || s.previewOpen || s.accountOpen,
  selectOverlayDrawerOpen: (s: typeof drawers) => s.navOpen || s.previewOpen || s.accountOpen,
}));

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: () => ({
    openOrgSettings: vi.fn(),
    openSettings: vi.fn(),
  }),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectContext: () => null,
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

vi.mock("../../context/SidebarSearchContext", () => ({
  useSidebarSearch: () => ({ query: "", setQuery: vi.fn() }),
}));

vi.mock("../../apps/projects/useProjectsList", () => ({
  useProjectsList: () => ({
    projects: [],
    mostRecentProject: null,
    openNewProjectModal: vi.fn(),
  }),
}));

vi.mock("../../utils/storage", () => ({
  getLastAgentEntry: () => null,
}));

vi.mock("../../utils/mobileNavigation", () => ({
  getMobileProjectDestination: () => null,
  getMobileShellMode: () => "root",
  getProjectIdFromPathname: () => null,
  isProjectSubroute: () => false,
  projectAgentRoute: (id: string) => `/projects/${id}/agent`,
  projectFilesRoute: (id: string) => `/projects/${id}/files`,
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

vi.mock("../AppShell/AppShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { MobileShell } from "../MobileShell";

function renderMobile(path = "/projects") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <MobileShell />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  drawers.navOpen = false;
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

  it("renders bottom navigation with 4 items", () => {
    renderMobile();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Feed")).toBeInTheDocument();
  });

  it("renders AURA title when no project", () => {
    renderMobile();
    expect(screen.getByText("AURA")).toBeInTheDocument();
  });

  it("renders account button", () => {
    renderMobile();
    expect(screen.getByRole("button", { name: "Open account" })).toBeInTheDocument();
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

  it("hides bottom nav when a drawer is open", () => {
    drawers.navOpen = true;
    renderMobile();
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
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
