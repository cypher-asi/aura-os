import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
const openBuyCredits = vi.fn();
const openOrgSettings = vi.fn();
const openOrFocus = vi.fn();
const closeWindow = vi.fn();
const toggleFavorite = vi.fn();
const registerAgents = vi.fn();
const registerRemoteAgents = vi.fn();
const getTaskbarAppsCollapsed = vi.fn();
const setTaskbarAppsCollapsed = vi.fn();

const activeAppState = {
  activeApp: { id: "projects" },
};

const appUIState = {
  previousPath: "/projects",
};

const desktopWindowState = {
  windows: {} as Record<string, unknown>,
  openOrFocus,
  closeWindow,
};

const favoriteAgents = [
  {
    agent_id: "agent-1",
    name: "Desk Helper",
    machine_type: "local",
    icon: null,
  },
];

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("lucide-react", () => ({
  Circle: () => <svg />,
  CreditCard: () => <svg />,
  Settings: () => <svg />,
  ChevronRight: () => <svg data-testid="chevron-right" />,
  ChevronLeft: () => <svg data-testid="chevron-left" />,
  LayoutGrid: () => <svg data-testid="layout-grid" />,
  StarOff: () => <svg />,
  X: () => <svg />,
  HelpCircle: () => <svg />,
  MessageSquare: () => <svg />,
  FolderPlus: () => <svg />,
  Bot: () => <svg />,
  Sparkles: () => <svg />,
  Check: () => <svg />,
  ChevronDown: () => <svg />,
  ChevronUp: () => <svg />,
  Image: () => <svg />,
  Upload: () => <svg />,
}));

interface MockMenuItem {
  id: string;
  label: string;
}

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>{icon}{children}</button>
  ),
  Menu: ({
    items,
    onChange,
  }: {
    items: MockMenuItem[];
    onChange?: (id: string) => void;
  }) => (
    <div role="menu" data-testid="zui-menu">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          onClick={() => onChange?.(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
  Modal: ({ isOpen, children }: { isOpen: boolean; children?: React.ReactNode }) =>
    isOpen ? <div data-testid="modal">{children}</div> : null,
  Heading: ({ children }: { children?: React.ReactNode }) => <h4>{children}</h4>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../apps/desktop/BackgroundModal", () => ({
  BackgroundModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="background-modal" /> : null,
}));

vi.mock("../CreditsBadge/useCreditBalance", () => ({
  useCreditBalance: () => ({ credits: 1200 }),
}));

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: (
    selector: (state: { openBuyCredits: typeof openBuyCredits; openOrgSettings: typeof openOrgSettings }) => unknown,
  ) => selector({ openBuyCredits, openOrgSettings }),
}));

vi.mock("../../hooks/use-active-app", () => ({
  useActiveApp: () => activeAppState.activeApp,
  useActiveAppId: () => activeAppState.activeApp.id,
}));

vi.mock("../../stores/app-ui-store", () => ({
  useAppUIStore: (selector: (state: typeof appUIState) => unknown) => selector(appUIState),
}));

vi.mock("../../stores/desktop-window-store", () => ({
  useDesktopWindowStore: (
    selector: (state: {
      windows: typeof desktopWindowState.windows;
      openOrFocus: typeof openOrFocus;
      closeWindow: typeof closeWindow;
    }) => unknown,
  ) => selector(desktopWindowState),
  selectIsWindowOpen: (agentId: string) => (state: { windows: typeof desktopWindowState.windows }) =>
    !!state.windows[agentId],
}));

vi.mock("../../utils/storage", () => ({
  getTaskbarAppsCollapsed: () => getTaskbarAppsCollapsed(),
  setTaskbarAppsCollapsed: (collapsed: boolean) => setTaskbarAppsCollapsed(collapsed),
}));

vi.mock("../ConnectionDot/ConnectionDot", () => ({
  ConnectionDot: () => <span data-testid="connection-dot" />,
}));

vi.mock("../Avatar", () => ({
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>,
}));

vi.mock("../AppNavRail", () => ({
  TASKBAR_ICON_SIZE: 15,
  AppNavRail: (props: Record<string, unknown>) => (
    <div
      data-testid="app-nav-rail"
      data-allow-reorder={String(Boolean(props.allowReorder))}
      data-include-ids={JSON.stringify(props.includeIds ?? null)}
    />
  ),
  TaskbarIconButton: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>{icon}{children}</button>
  ),
}));

vi.mock("../../apps/agents/stores", () => ({
  useFavoriteAgents: () => favoriteAgents,
  useAgentStore: (selector: (state: { toggleFavorite: typeof toggleFavorite }) => unknown) =>
    selector({ toggleFavorite }),
}));

vi.mock("../../hooks/use-avatar-state", () => ({
  useAvatarState: () => ({ status: "online", isLocal: true }),
}));

vi.mock("../../stores/profile-status-store", () => ({
  useProfileStatusStore: (
    selector: (state: {
      registerAgents: typeof registerAgents;
      registerRemoteAgents: typeof registerRemoteAgents;
    }) => unknown,
  ) => selector({ registerAgents, registerRemoteAgents }),
}));

vi.mock("./BottomTaskbar.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { BottomTaskbar } from "./BottomTaskbar";

beforeEach(() => {
  vi.clearAllMocks();
  activeAppState.activeApp = { id: "projects" };
  appUIState.previousPath = "/projects";
  desktopWindowState.windows = {};
  getTaskbarAppsCollapsed.mockReturnValue(true);
});

describe("BottomTaskbar", () => {
  it("opens a favorite agent without navigating to desktop when outside desktop mode", async () => {
    const user = userEvent.setup();

    render(<BottomTaskbar />);

    await user.click(screen.getByRole("button", { name: "Desk Helper" }));

    expect(openOrFocus).toHaveBeenCalledWith("agent-1");
    expect(closeWindow).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("closes an already-open favorite agent outside desktop mode", async () => {
    const user = userEvent.setup();
    desktopWindowState.windows = {
      "agent-1": { agentId: "agent-1" },
    };

    render(<BottomTaskbar />);

    await user.click(screen.getByRole("button", { name: "Desk Helper" }));

    expect(closeWindow).toHaveBeenCalledWith("agent-1");
    expect(openOrFocus).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("keeps the same close toggle on desktop", async () => {
    const user = userEvent.setup();
    activeAppState.activeApp = { id: "desktop" };
    desktopWindowState.windows = {
      "agent-1": { agentId: "agent-1" },
    };

    render(<BottomTaskbar />);

    await user.click(screen.getByRole("button", { name: "Desk Helper" }));

    expect(closeWindow).toHaveBeenCalledWith("agent-1");
    expect(openOrFocus).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders the taskbar apps collapsed by default", () => {
    render(<BottomTaskbar />);

    expect(screen.getByRole("button", { name: "Expand apps" })).toBeInTheDocument();
    expect(screen.getByTestId("chevron-right")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show credits balance" })).toBeInTheDocument();

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute(
      "data-include-ids",
      JSON.stringify(["agents", "projects"]),
    );
    expect(leftNavRail).toHaveAttribute("data-allow-reorder", "true");
    expect(navRails[1]).toHaveAttribute("data-allow-reorder", "false");
  });

  it("restores the expanded state from storage", () => {
    getTaskbarAppsCollapsed.mockReturnValue(false);

    render(<BottomTaskbar />);

    expect(screen.getByRole("button", { name: "Collapse apps" })).toBeInTheDocument();

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute("data-include-ids", "null");
  });

  it("shows the credits balance inline from the right chevron", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar />);

    expect(screen.queryByText("1,200 Z")).not.toBeInTheDocument();

    const creditsToggle = screen.getByRole("button", { name: "Show credits balance" });
    const creditsButton = screen.getByRole("button", { name: "Credits" });

    expect(
      creditsToggle.compareDocumentPosition(creditsButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(creditsToggle);

    const creditsSummary = screen.getByText("1,200 Z");
    expect(screen.getByRole("button", { name: "Hide credits balance" })).toBeInTheDocument();
    expect(
      creditsToggle.compareDocumentPosition(creditsSummary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      creditsSummary.compareDocumentPosition(creditsButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the credits balance on a second right chevron click", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar />);

    await user.click(screen.getByRole("button", { name: "Show credits balance" }));
    await user.click(screen.getByRole("button", { name: "Hide credits balance" }));

    expect(screen.getByRole("button", { name: "Show credits balance" })).toBeInTheDocument();
    expect(screen.queryByText("1,200 Z")).not.toBeInTheDocument();
  });

  it("opens settings from the taskbar shortcut", async () => {
    const user = userEvent.setup();

    render(<BottomTaskbar />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(openOrgSettings).toHaveBeenCalledTimes(1);
  });

  it("expands to all apps when the chevron is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar />);

    await user.click(screen.getByRole("button", { name: "Expand apps" }));

    expect(screen.getByRole("button", { name: "Collapse apps" })).toBeInTheDocument();
    expect(setTaskbarAppsCollapsed).toHaveBeenCalledWith(false);

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute("data-include-ids", "null");
  });

  it("collapses back to agents and projects on a second chevron click", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar />);

    const chevron = screen.getByRole("button", { name: "Expand apps" });
    await user.click(chevron);
    await user.click(screen.getByRole("button", { name: "Collapse apps" }));

    expect(screen.getByRole("button", { name: "Expand apps" })).toBeInTheDocument();
    expect(setTaskbarAppsCollapsed).toHaveBeenNthCalledWith(1, false);
    expect(setTaskbarAppsCollapsed).toHaveBeenNthCalledWith(2, true);

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute(
      "data-include-ids",
      JSON.stringify(["agents", "projects"]),
    );
  });

  describe("right-click context menu", () => {
    function getBar(container: HTMLElement) {
      const bar = container.querySelector<HTMLElement>(
        '[data-agent-surface="desktop-shell-bottom-taskbar"]',
      );
      if (!bar) throw new Error("Bottom taskbar root not found");
      return bar;
    }

    it("opens the desktop context menu when right-clicking empty taskbar space", () => {
      const { container } = render(<BottomTaskbar />);

      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();

      fireEvent.contextMenu(getBar(container));

      expect(screen.getByTestId("zui-menu")).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Set Background/ })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    });

    it("does not open the desktop context menu when right-clicking a taskbar button", () => {
      render(<BottomTaskbar />);

      fireEvent.contextMenu(screen.getByRole("button", { name: "Settings" }));

      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();
    });

    it("opens org settings when selecting Settings from the context menu", async () => {
      const user = userEvent.setup();
      const { container } = render(<BottomTaskbar />);

      fireEvent.contextMenu(getBar(container));
      await user.click(screen.getByRole("menuitem", { name: "Settings" }));

      expect(openOrgSettings).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();
    });

    it("opens the background modal when selecting Set Background", async () => {
      const user = userEvent.setup();
      const { container } = render(<BottomTaskbar />);

      fireEvent.contextMenu(getBar(container));
      await user.click(screen.getByRole("menuitem", { name: /Set Background/ }));

      expect(screen.getByTestId("background-modal")).toBeInTheDocument();
    });

    it("anchors to the bottom of the click when right-clicking near the viewport bottom", () => {
      const originalInnerHeight = window.innerHeight;
      const originalInnerWidth = window.innerWidth;
      Object.defineProperty(window, "innerHeight", {
        value: 800,
        configurable: true,
      });
      Object.defineProperty(window, "innerWidth", {
        value: 1280,
        configurable: true,
      });

      try {
        const { container } = render(<BottomTaskbar />);

        fireEvent.contextMenu(getBar(container), {
          clientX: 200,
          clientY: 790,
        });

        const overlay = screen.getByTestId("zui-menu").parentElement as HTMLElement;
        expect(overlay.style.bottom).not.toBe("");
        expect(overlay.style.top).toBe("");
      } finally {
        Object.defineProperty(window, "innerHeight", {
          value: originalInnerHeight,
          configurable: true,
        });
        Object.defineProperty(window, "innerWidth", {
          value: originalInnerWidth,
          configurable: true,
        });
      }
    });
  });
});
