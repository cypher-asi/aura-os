import { render, screen } from "@testing-library/react";
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
  StarOff: () => <svg />,
  X: () => <svg />,
}));

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>{icon}{children}</button>
  ),
  Menu: () => null,
}));

vi.mock("../CreditsBadge/useCreditBalance", () => ({
  useCreditBalance: () => ({ credits: 1200 }),
}));

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: (
    selector: (state: { openBuyCredits: typeof openBuyCredits; openOrgSettings: typeof openOrgSettings }) => unknown,
  ) => selector({ openBuyCredits, openOrgSettings }),
}));

vi.mock("../../stores/app-store", () => ({
  useAppStore: (selector: (state: typeof activeAppState) => unknown) => selector(activeAppState),
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
    expect(screen.getByTestId("chevron-left")).toBeInTheDocument();

    const navRails = screen.getAllByTestId("app-nav-rail");
    const leftNavRail = navRails[0];
    expect(leftNavRail).toHaveAttribute("data-include-ids", "null");
  });

  it("opens team settings from the taskbar shortcut", async () => {
    const user = userEvent.setup();

    render(<BottomTaskbar />);

    await user.click(screen.getByRole("button", { name: "Team settings" }));

    expect(openOrgSettings).toHaveBeenCalledTimes(1);
  });

  it("expands to all apps when the chevron is clicked", async () => {
    const user = userEvent.setup();
    render(<BottomTaskbar />);

    await user.click(screen.getByRole("button", { name: "Expand apps" }));

    expect(screen.getByRole("button", { name: "Collapse apps" })).toBeInTheDocument();
    expect(screen.getByTestId("chevron-left")).toBeInTheDocument();
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
});
