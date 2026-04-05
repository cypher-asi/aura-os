import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockActiveApp = {
  id: "projects",
  label: "Projects",
  basePath: "/projects",
  LeftPanel: () => <div data-testid="left-panel" />,
  MainPanel: ({ children }: { children?: React.ReactNode }) => <div data-testid="main-panel">{children}</div>,
  SidekickPanel: () => <div data-testid="sidekick-panel" />,
  SidekickTaskbar: () => <div data-testid="sidekick-taskbar" />,
  SidekickHeader: () => <div data-testid="sidekick-header" />,
  PreviewPanel: () => <div data-testid="preview-panel" />,
  PreviewHeader: () => <div data-testid="preview-header" />,
};

vi.mock("@cypher-asi/zui", () => ({
  Topbar: ({ title, actions, icon }: { title?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) => (
    <header data-testid="topbar">{icon}{title}{actions}</header>
  ),
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; iconOnly?: boolean; variant?: string; size?: string }) => (
    <button {...props}>{props.icon}{children}</button>
  ),
}));

vi.mock("../../stores/app-store", () => ({
  useAppStore: (sel: (s: { activeApp: typeof mockActiveApp }) => unknown) =>
    sel({ activeApp: mockActiveApp }),
}));

vi.mock("../../stores/app-ui-store", () => ({
  useAppUIStore: (sel: (s: { visitedAppIds: Set<string> }) => unknown) =>
    sel({ visitedAppIds: new Set(["projects"]) }),
}));

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: () => ({
    hostSettingsOpen: false,
    openHostSettings: vi.fn(),
    closeHostSettings: vi.fn(),
  }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    features: {
      windowControls: false,
      linkedWorkspace: false,
      nativeUpdater: false,
      hostRetargeting: false,
      ideIntegration: false,
    },
  }),
}));

vi.mock("../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => ({
    query: "",
    setQuery: vi.fn(),
    action: null,
  }),
}));

const mockSidekickState = { previewItem: null };
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("../../apps/registry", () => ({
  apps: [
    {
      id: "projects",
      label: "Projects",
      basePath: "/projects",
      LeftPanel: () => <div data-testid="left-panel" />,
      SidekickPanel: () => <div data-testid="sidekick-panel" />,
    },
  ],
}));

vi.mock("../AppNavRail", () => ({
  AppNavRail: () => <nav data-testid="nav-rail" />,
}));
vi.mock("../BottomTaskbar", () => ({
  BottomTaskbar: () => <div data-testid="bottom-taskbar" />,
}));
vi.mock("../Lane", () => ({
  Lane: ({ children, header, taskbar }: { children?: React.ReactNode; header?: React.ReactNode; taskbar?: React.ReactNode }) => (
    <div data-testid="lane">
      {header}
      {taskbar}
      {children}
    </div>
  ),
}));
vi.mock("../ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../HostSettingsModal", () => ({
  HostSettingsModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="host-settings" /> : null,
}));
vi.mock("../UpdateBanner", () => ({
  UpdateBanner: () => <div data-testid="update-banner" />,
}));
vi.mock("../PanelSearch", () => ({
  PanelSearch: () => <div data-testid="panel-search" />,
}));
vi.mock("../WindowControls", () => ({
  WindowControls: () => <div data-testid="window-controls" />,
}));
vi.mock("../../lib/windowCommand", () => ({
  windowCommand: vi.fn(),
}));

vi.mock("../AppShell/AppShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

import { DesktopShell } from "../DesktopShell";

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/projects"]}>
      <DesktopShell />
    </MemoryRouter>,
  );
}

describe("DesktopShell", () => {
  it("renders the nav rail", () => {
    renderShell();
    expect(screen.getByTestId("nav-rail")).toBeInTheDocument();
  });

  it("renders the AURA title link", () => {
    renderShell();
    expect(screen.getByAltText("AURA")).toBeInTheDocument();
  });

  it("renders update banner", () => {
    renderShell();
    expect(screen.getByTestId("update-banner")).toBeInTheDocument();
  });

  it("renders bottom taskbar", () => {
    renderShell();
    expect(screen.getByTestId("bottom-taskbar")).toBeInTheDocument();
  });

  it("renders main panel from active app", () => {
    renderShell();
    expect(screen.getByTestId("main-panel")).toBeInTheDocument();
  });

  it("renders left panel from active app", () => {
    renderShell();
    expect(screen.getByTestId("left-panel")).toBeInTheDocument();
  });

  it("renders sidebar search input", () => {
    renderShell();
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
  });

  it("does not show host settings button when feature is disabled", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: "Open host settings" })).not.toBeInTheDocument();
  });
});
