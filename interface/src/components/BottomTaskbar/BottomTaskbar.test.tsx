import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
const openBuyCredits = vi.fn();
const openOrgSettings = vi.fn();
const openOrgTheme = vi.fn();
const openOrgBackground = vi.fn();
const openAppsModal = vi.fn();
const openInviteModal = vi.fn();
const closeInviteModal = vi.fn();
const openOrFocus = vi.fn();
const closeWindow = vi.fn();
const toggleFavorite = vi.fn();
const registerAgents = vi.fn();
const registerRemoteAgents = vi.fn();
const getTaskbarAppsCollapsed = vi.fn();
const setTaskbarAppsCollapsed = vi.fn();
const getTaskbarRightCollapsed = vi.fn();
const setTaskbarRightCollapsed = vi.fn();

const uiModalState = {
  openBuyCredits,
  openOrgSettings,
  openOrgTheme,
  openOrgBackground,
  openAppsModal,
  openInviteModal,
  closeInviteModal,
  inviteModalOpen: false,
};

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
  useLocation: () => ({ pathname: "/", search: "", hash: "", state: null, key: "test" }),
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
  Globe: () => <svg data-testid="icon-globe" />,
  ChevronDown: () => <svg />,
  ChevronUp: () => <svg />,
  Image: () => <svg />,
  Palette: () => <svg />,
  Upload: () => <svg />,
  Sun: () => <svg data-testid="theme-icon-sun" />,
  Moon: () => <svg data-testid="theme-icon-moon" />,
  Zap: () => <svg data-testid="icon-zap" />,
  PanelLeft: () => <svg data-testid="panel-left" />,
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
  useTheme: () => ({
    theme: "dark" as const,
    resolvedTheme: "dark" as const,
    setTheme: vi.fn(),
  }),
}));

vi.mock("../InviteModal/InviteModal", () => ({
  InviteModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="invite-modal" /> : null,
}));

vi.mock("../CreditsBadge/useCreditBalance", () => ({
  useCreditBalance: () => ({ credits: 1200 }),
}));

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: (selector: (state: typeof uiModalState) => unknown) => selector(uiModalState),
}));

const profileState = {
  profile: {
    name: "Ada Lovelace",
    handle: "@ada",
    bio: "",
    website: "",
    location: "",
    joinedDate: "",
    avatarUrl: undefined as string | undefined,
  },
};

vi.mock("../../stores/profile-store", () => ({
  useProfileStore: (selector: (state: typeof profileState) => unknown) =>
    selector(profileState),
}));

const billingState = {
  subscription: null as { plan: string; is_subscribed: boolean } | null,
  fetchSubscription: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../stores/billing-store", () => ({
  useBillingStore: (selector: (state: typeof billingState) => unknown) =>
    selector(billingState),
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
  getTaskbarRightCollapsed: () => getTaskbarRightCollapsed(),
  setTaskbarRightCollapsed: (collapsed: boolean) => setTaskbarRightCollapsed(collapsed),
}));

vi.mock("../ConnectionDot/ConnectionDot", () => ({
  ConnectionDot: () => <span data-testid="connection-dot" />,
}));

vi.mock("../Avatar", () => ({
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>,
}));

vi.mock("../OrgSelector", () => ({
  OrgSelector: () => (
    <button type="button" aria-label="Switch team" data-testid="org-selector">
      Switch team
    </button>
  ),
}));

vi.mock("../AppNavRail", () => ({
  TASKBAR_ICON_SIZE: 16,
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
  billingState.subscription = null;
  billingState.fetchSubscription.mockResolvedValue(undefined);
  getTaskbarAppsCollapsed.mockReturnValue(true);
  getTaskbarRightCollapsed.mockReturnValue(true);
});

describe("BottomTaskbar", () => {
  it("places the OrgSelector after ProfilePill in the left cluster in standard mode (Desktop icon is no longer in .left)", () => {
    const { container } = render(<BottomTaskbar mode="standard" />);

    const leftSlot = container.querySelector<HTMLElement>(".left");
    expect(leftSlot).not.toBeNull();
    if (!leftSlot) return;

    // The `.left` cluster now reads as ProfilePill ("Open settings")
    // then OrgSelector ("Switch team"). The Desktop circle moved to
    // the front of the `.center` cluster, so it must not be present
    // inside `.left` anymore.
    const buttons = Array.from(leftSlot.querySelectorAll("button"));
    const profilePillIndex = buttons.findIndex(
      (btn) => btn.getAttribute("aria-label") === "Open settings",
    );
    const orgSelectorIndex = buttons.findIndex(
      (btn) => btn.getAttribute("aria-label") === "Switch team",
    );

    expect(profilePillIndex).toBeGreaterThanOrEqual(0);
    expect(orgSelectorIndex).toBeGreaterThan(profilePillIndex);
    expect(
      leftSlot.querySelector('button[aria-label="Desktop"]'),
    ).toBeNull();
  });

  it("hosts the Desktop circle in its own standalone bubble, not in the .center cluster", () => {
    const { container } = render(<BottomTaskbar mode="standard" />);

    // Desktop lives in its own circular `.desktopBubble` (far left),
    // separate from both the `.left` ProfilePill cluster and the
    // `.center` app rail.
    const desktopBubble = container.querySelector<HTMLElement>(".desktopBubble");
    expect(desktopBubble).not.toBeNull();
    expect(
      desktopBubble?.querySelector('button[aria-label="Desktop"]'),
    ).not.toBeNull();

    const centerSlot = container.querySelector<HTMLElement>(".center");
    expect(centerSlot).not.toBeNull();
    expect(
      centerSlot?.querySelector('button[aria-label="Desktop"]'),
    ).toBeNull();
  });

  it("leads the .center cluster with the AppNavRail, ahead of the Apps button", () => {
    const { container } = render(<BottomTaskbar mode="standard" />);

    const centerSlot = container.querySelector<HTMLElement>(".center");
    expect(centerSlot).not.toBeNull();
    if (!centerSlot) return;

    const navRail = centerSlot.querySelector<HTMLElement>(
      '[data-testid="app-nav-rail"]',
    );
    const appsButton = centerSlot.querySelector<HTMLElement>(
      'button[aria-label="Apps"]',
    );
    expect(navRail).not.toBeNull();
    expect(appsButton).not.toBeNull();

    const orderedChildren = Array.from(centerSlot.children);
    const navRailIndex = orderedChildren.indexOf(navRail as Element);
    const appsIndex = orderedChildren.indexOf(appsButton as Element);

    expect(navRailIndex).toBeGreaterThanOrEqual(0);
    expect(navRailIndex).toBeLessThan(appsIndex);
  });

  it("opens a favorite agent without navigating to desktop when outside desktop mode", async () => {
    const user = userEvent.setup();

    render(<BottomTaskbar mode="standard" />);

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

    render(<BottomTaskbar mode="standard" />);

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

    render(<BottomTaskbar mode="standard" />);

    await user.click(screen.getByRole("button", { name: "Desk Helper" }));

    expect(closeWindow).toHaveBeenCalledWith("agent-1");
    expect(openOrFocus).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders the taskbar apps collapsed by default", () => {
    render(<BottomTaskbar mode="standard" />);

    expect(screen.getByRole("button", { name: "Expand apps" })).toBeInTheDocument();
    expect(screen.getAllByTestId("chevron-right").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Expand taskbar" })).toBeInTheDocument();

    // With the right cluster collapsed by default, the profile rail is
    // hidden, so only the reorderable center rail remains mounted.
    const navRails = screen.getAllByTestId("app-nav-rail");
    expect(navRails).toHaveLength(1);
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute(
      "data-include-ids",
      JSON.stringify(["agents", "projects"]),
    );
    expect(leftNavRail).toHaveAttribute("data-allow-reorder", "true");
  });

  it("restores the expanded state from storage", () => {
    getTaskbarAppsCollapsed.mockReturnValue(false);

    render(<BottomTaskbar mode="standard" />);

    expect(screen.getByRole("button", { name: "Collapse apps" })).toBeInTheDocument();

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute("data-include-ids", "null");
  });

  it("hides Credits/Theme/Help and the profile rail when the right cluster is collapsed by default, but keeps Settings visible", () => {
    render(<BottomTaskbar mode="standard" />);

    expect(screen.getByRole("button", { name: "Expand taskbar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Credits" })).not.toBeInTheDocument();
    // Settings is rendered outside the collapsible secondary cluster
    // so it remains one click away regardless of `rightCollapsed`.
    // The profile shortcut, however, now collapses with the secondary
    // cluster so a collapsed right cluster reads as Settings only.
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();

    const profileNavRail = screen.queryAllByTestId("app-nav-rail").find((rail) =>
      rail.getAttribute("data-include-ids") === JSON.stringify(["profile"]),
    );
    expect(profileNavRail).toBeUndefined();
  });

  it("restores the profile rail when the right cluster is expanded", () => {
    getTaskbarRightCollapsed.mockReturnValue(false);

    render(<BottomTaskbar mode="standard" />);

    const profileNavRail = screen.getAllByTestId("app-nav-rail").find((rail) =>
      rail.getAttribute("data-include-ids") === JSON.stringify(["profile"]),
    );
    expect(profileNavRail).toBeDefined();
  });

  it("places Settings directly to the left of the clock readout in standard mode", () => {
    const { container } = render(<BottomTaskbar mode="standard" />);

    const rightSlot = container.querySelector<HTMLElement>(".right");
    expect(rightSlot).not.toBeNull();
    if (!rightSlot) return;

    const rightPrimary = rightSlot.querySelector<HTMLElement>(".rightPrimary");
    const clock = rightSlot.querySelector<HTMLElement>(".clock");
    expect(rightPrimary).not.toBeNull();
    expect(clock).not.toBeNull();
    if (!rightPrimary || !clock) return;

    // The clock readout is the trailing sibling inside `.right`, so
    // "directly to the left of the time" means Settings must be the
    // final child of `.rightPrimary` — and `.rightPrimary` itself
    // must immediately precede `.clock` inside `.right`.
    const rightChildren = Array.from(rightSlot.children);
    expect(rightChildren.indexOf(rightPrimary)).toBe(rightChildren.indexOf(clock) - 1);

    const settingsButton = rightPrimary.querySelector<HTMLElement>(
      'button[aria-label="Settings"]',
    );
    expect(settingsButton).not.toBeNull();
    expect(rightPrimary.lastElementChild).toBe(settingsButton);
  });

  it("keeps Settings visible in standard mode even when the right cluster is collapsed (always-on settings affordance)", () => {
    // Default fixture has `getTaskbarRightCollapsed.mockReturnValue(true)`,
    // so this asserts the always-on behavior directly: even when the
    // user has the cluster collapsed, the Settings shortcut must still
    // render and remain clickable.
    render(<BottomTaskbar mode="standard" />);

    const settingsButton = screen.getByRole("button", { name: "Settings" });
    expect(settingsButton).toBeInTheDocument();

    fireEvent.click(settingsButton);
    expect(openOrgSettings).toHaveBeenCalledTimes(1);
  });

  it("expands the right cluster and persists the state when the chevron is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar mode="standard" />);

    await user.click(screen.getByRole("button", { name: "Expand taskbar" }));

    expect(screen.getByRole("button", { name: "Collapse taskbar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credits" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(setTaskbarRightCollapsed).toHaveBeenCalledWith(false);
  });

  it("re-collapses the right cluster on a second chevron click", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar mode="standard" />);

    await user.click(screen.getByRole("button", { name: "Expand taskbar" }));
    await user.click(screen.getByRole("button", { name: "Collapse taskbar" }));

    expect(screen.getByRole("button", { name: "Expand taskbar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Credits" })).not.toBeInTheDocument();
    // Settings is now rendered outside the collapsible secondary
    // cluster, so re-collapsing must still leave the Settings
    // shortcut mounted as the trailing item in `.rightPrimary`.
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(setTaskbarRightCollapsed).toHaveBeenNthCalledWith(1, false);
    expect(setTaskbarRightCollapsed).toHaveBeenNthCalledWith(2, true);
  });

  it("restores the expanded right cluster state from storage", () => {
    getTaskbarRightCollapsed.mockReturnValue(false);

    render(<BottomTaskbar mode="standard" />);

    expect(screen.getByRole("button", { name: "Collapse taskbar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credits" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("opens settings from the taskbar shortcut", async () => {
    const user = userEvent.setup();
    getTaskbarRightCollapsed.mockReturnValue(false);

    render(<BottomTaskbar mode="standard" />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(openOrgSettings).toHaveBeenCalledTimes(1);
  });

  it("expands to all apps when the chevron is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar mode="standard" />);

    await user.click(screen.getByRole("button", { name: "Expand apps" }));

    expect(screen.getByRole("button", { name: "Collapse apps" })).toBeInTheDocument();
    expect(setTaskbarAppsCollapsed).toHaveBeenCalledWith(false);

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute("data-include-ids", "null");
  });

  it("collapses back to agents and projects on a second chevron click", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar mode="standard" />);

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
      const { container } = render(<BottomTaskbar mode="standard" />);

      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();

      fireEvent.contextMenu(getBar(container));

      expect(screen.getByTestId("zui-menu")).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Theme" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Background" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    });

    it("does not open the desktop context menu when right-clicking a taskbar button", () => {
      render(<BottomTaskbar mode="standard" />);

      fireEvent.contextMenu(screen.getByRole("button", { name: "Apps" }));

      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();
    });

    it("opens org settings when selecting Settings from the context menu", async () => {
      const user = userEvent.setup();
      const { container } = render(<BottomTaskbar mode="standard" />);

      fireEvent.contextMenu(getBar(container));
      await user.click(screen.getByRole("menuitem", { name: "Settings" }));

      expect(openOrgSettings).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();
    });

    it("opens settings to Theme > Background when selecting Background", async () => {
      const user = userEvent.setup();
      const { container } = render(<BottomTaskbar mode="standard" />);

      fireEvent.contextMenu(getBar(container));
      await user.click(screen.getByRole("menuitem", { name: "Background" }));

      expect(openOrgBackground).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();
    });

    it("opens settings to Theme when selecting Theme", async () => {
      const user = userEvent.setup();
      const { container } = render(<BottomTaskbar mode="standard" />);

      fireEvent.contextMenu(getBar(container));
      await user.click(screen.getByRole("menuitem", { name: "Theme" }));

      expect(openOrgTheme).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("zui-menu")).not.toBeInTheDocument();
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
        const { container } = render(<BottomTaskbar mode="standard" />);

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

  describe("standard mode chrome", () => {
    it("renders Desktop, Apps, the clock, the .center cluster, and the profile rail (right cluster expanded)", () => {
      getTaskbarRightCollapsed.mockReturnValue(false);
      const { container } = render(<BottomTaskbar mode="standard" />);

      expect(screen.getByRole("button", { name: "Desktop" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apps" })).toBeInTheDocument();
      expect(container.querySelector(".clock")).not.toBeNull();
      expect(container.querySelector(".left")).not.toBeNull();
      expect(container.querySelector(".center")).not.toBeNull();
      // Center reorderable rail + bottom-right profile rail.
      expect(screen.getAllByTestId("app-nav-rail")).toHaveLength(2);
    });
  });

  describe("Public mode", () => {
    it("renders the sidebar toggle in the public left cluster, the theme toggle left of the language selector on the right, and the tagline centered", () => {
      const { container } = render(<BottomTaskbar mode="public" />);

      const bar = container.querySelector(
        '[data-agent-surface="desktop-shell-bottom-taskbar"]',
      );
      expect(bar).not.toBeNull();
      expect(bar).toHaveAttribute("data-ui-mode", "public");

      // The left cluster (`.publicLeft`) leads with the sidebar drawer
      // toggle (relocated from the titlebar) followed by the Chat link.
      // The rotating tagline lives in the absolutely-centered
      // `.publicCenter` wrapper. The right cluster (`.publicRight`)
      // carries the theme toggle (`.themePill`), then the language
      // selector (`.langPill`), then the "Powered by THE GRID" chip
      // (`.poweredPill`). Credits, Settings, Apps, Desktop, the profile
      // rail, and the clock are all gated behind `AuthedBottomTaskbar`
      // which doesn't mount.
      const themeToggle = screen.getByRole("button", { name: /switch theme/i });
      expect(themeToggle).toBeInTheDocument();

      const publicLeft = container.querySelector(".publicLeft");
      expect(publicLeft).not.toBeNull();

      const sidebarToggle = screen.getByRole("button", { name: "Toggle sidebar" });
      expect(publicLeft).toContainElement(sidebarToggle);

      const publicCenter = container.querySelector(".publicCenter");
      expect(publicCenter).not.toBeNull();
      const taglineBubble = container.querySelector(".taglineBubble");
      expect(taglineBubble).not.toBeNull();
      expect(publicCenter).toContainElement(taglineBubble as HTMLElement);

      // The theme toggle now lives in `.publicRight`, immediately to the
      // left of the language selector, ahead of the "Powered by THE GRID"
      // chip.
      const publicRight = container.querySelector(".publicRight");
      expect(publicRight).not.toBeNull();
      const themePill = container.querySelector(".themePill");
      expect(themePill).not.toBeNull();
      expect(themePill).toContainElement(themeToggle);
      expect(publicRight).toContainElement(themePill as HTMLElement);

      const langPill = container.querySelector(".langPill");
      expect(langPill).not.toBeNull();
      expect(publicRight).toContainElement(langPill as HTMLElement);

      const poweredPill = container.querySelector(".poweredPill");
      expect(poweredPill).not.toBeNull();
      expect(publicRight).toContainElement(poweredPill as HTMLElement);

      // Order within `.publicRight`: theme toggle -> language -> powered.
      expect(
        themePill!.compareDocumentPosition(langPill as HTMLElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        (langPill as HTMLElement).compareDocumentPosition(poweredPill as HTMLElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // The theme toggle must not be wrapped inside the tagline bubble.
      expect(taglineBubble).not.toContainElement(themeToggle);

      expect(
        screen.queryByRole("button", { name: "Credits" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Settings" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Apps" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Desktop" }),
      ).not.toBeInTheDocument();
      expect(screen.queryAllByTestId("app-nav-rail")).toHaveLength(0);
      expect(container.querySelector(".clock")).toBeNull();
    });

    it("renders a 'Powered by THE GRID' link to the GitHub repo opening in a new tab", () => {
      render(<BottomTaskbar mode="public" />);

      const link = screen.getByRole("link", { name: /powered by the grid/i });
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/cypher-asi/the-grid",
      );
      expect(link).toHaveAttribute("target", "_blank");
      const rel = link.getAttribute("rel") ?? "";
      expect(rel).toContain("noopener");
      expect(rel).toContain("noreferrer");
    });

    it("does not render the 'Powered by THE GRID' link in the authed standard mode", () => {
      render(<BottomTaskbar mode="standard" />);
      expect(
        screen.queryByRole("link", { name: /powered by the grid/i }),
      ).not.toBeInTheDocument();
    });
  });
});
