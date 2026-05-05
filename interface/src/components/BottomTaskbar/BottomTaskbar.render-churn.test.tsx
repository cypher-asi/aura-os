import { act, render, screen } from "@testing-library/react";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";

const mockNavigate = vi.fn();
const openBuyCredits = vi.fn();
const openOrgSettings = vi.fn();
const toggleFavorite = vi.fn();
const registerAgents = vi.fn();
const registerRemoteAgents = vi.fn();

let appNavRailRenderCount = 0;

const activeAppState = {
  activeApp: { id: "projects" },
};

const appUIState = {
  previousPath: "/projects",
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
  ChevronRight: () => <svg />,
  ChevronLeft: () => <svg />,
  LayoutGrid: () => <svg />,
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

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>{icon}{children}</button>
  ),
  Menu: () => null,
  Modal: () => null,
  Heading: ({ children }: { children?: React.ReactNode }) => <h4>{children}</h4>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../apps/desktop/BackgroundModal", () => ({
  BackgroundModal: () => null,
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

vi.mock("../Avatar", () => ({
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>,
}));

vi.mock("../AppNavRail", () => ({
  TASKBAR_ICON_SIZE: 15,
  AppNavRail: () => {
    appNavRailRenderCount += 1;
    return <div data-testid="app-nav-rail" />;
  },
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

describe("BottomTaskbar render churn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appNavRailRenderCount = 0;
    localStorage.removeItem("aura:desktopWindows");
    localStorage.removeItem("aura-taskbar-apps-collapsed");
    useDesktopWindowStore.setState({ windows: {}, nextZ: 1 });
  });

  it("does not rerender unrelated taskbar chrome on window store updates", () => {
    render(<BottomTaskbar />);

    expect(appNavRailRenderCount).toBe(2);
    expect(screen.getByRole("button", { name: "Desk Helper" })).toBeInTheDocument();

    act(() => {
      useDesktopWindowStore.getState().openWindow("agent-1");
    });
    expect(appNavRailRenderCount).toBe(2);

    act(() => {
      useDesktopWindowStore.getState().moveWindow("agent-1", 180, 240);
    });
    expect(appNavRailRenderCount).toBe(2);

    act(() => {
      useDesktopWindowStore.getState().focusWindow("agent-1");
    });
    expect(appNavRailRenderCount).toBe(2);
  });
});
