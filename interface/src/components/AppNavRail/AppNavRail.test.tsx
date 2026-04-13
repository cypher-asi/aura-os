import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();
const saveTaskbarAppOrder = vi.fn();

function MockIcon({ size = 16 }: { size?: number }) {
  return <svg data-testid={`icon-${size}`} />;
}

const mockApps = [
  { id: "agents", label: "Agents", basePath: "/agents", icon: MockIcon, onPrefetch: vi.fn() },
  { id: "projects", label: "Projects", basePath: "/projects", icon: MockIcon, onPrefetch: vi.fn() },
  { id: "tasks", label: "Tasks", basePath: "/tasks", icon: MockIcon, onPrefetch: vi.fn() },
  { id: "process", label: "Process", basePath: "/process", icon: MockIcon, onPrefetch: vi.fn() },
  { id: "feed", label: "Feed", basePath: "/feed", icon: MockIcon, onPrefetch: vi.fn() },
  { id: "profile", label: "Profile", basePath: "/profile", icon: MockIcon, onPrefetch: vi.fn() },
  { id: "desktop", label: "Desktop", basePath: "/desktop", icon: MockIcon, onPrefetch: vi.fn() },
];

const state = {
  apps: mockApps,
  activeApp: mockApps[1],
  taskbarAppOrder: ["agents", "projects", "tasks", "process", "feed"],
  saveTaskbarAppOrder,
};

const navigationMemory = {
  lastSelectedAgentId: null as string | null,
  lastProject: null as string | null,
  lastAgent: null as string | null,
};

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    children,
    icon,
    iconOnly: _iconOnly,
    variant: _variant,
    size: _size,
    selected: _selected,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: React.ReactNode;
    iconOnly?: boolean;
    variant?: string;
    size?: string;
    selected?: boolean;
  }) => <button {...props}>{icon}{children}</button>,
}));

vi.mock("../../stores/app-store", () => ({
  useAppStore: (selector: (s: typeof state) => unknown) => selector(state),
  getOrderedTaskbarApps: (apps: typeof mockApps, taskbarAppOrder: string[]) => {
    const rank = new Map(taskbarAppOrder.map((id, index) => [id, index]));
    return [...apps].sort((a, b) => {
      const aRank = rank.get(a.id);
      const bRank = rank.get(b.id);
      if (aRank == null && bRank == null) return 0;
      if (aRank == null) return 1;
      if (bRank == null) return -1;
      return aRank - bRank;
    });
  },
}));

vi.mock("../../apps/agents/stores", () => ({
  getLastSelectedAgentId: () => navigationMemory.lastSelectedAgentId,
}));

vi.mock("../../utils/storage", () => ({
  getLastProject: () => navigationMemory.lastProject,
  getLastAgent: () => navigationMemory.lastAgent,
}));

vi.mock("../../apps/process/stores/process-store", () => ({
  LAST_PROCESS_ID_KEY: "last-process-id",
}));

vi.mock("./AppNavRail.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { AppNavRail } from "./AppNavRail";

beforeEach(() => {
  vi.clearAllMocks();
  state.activeApp = mockApps[1];
  state.taskbarAppOrder = ["agents", "projects", "tasks", "process", "feed"];
  navigationMemory.lastSelectedAgentId = null;
  navigationMemory.lastProject = null;
  navigationMemory.lastAgent = null;
});

describe("AppNavRail", () => {
  it("renders the primary apps in taskbar layout and excludes desktop", () => {
    render(<AppNavRail layout="taskbar" />);

    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Process" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Feed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desktop" })).not.toBeInTheDocument();
  });

  it("keeps the active app selected in taskbar layout", () => {
    state.activeApp = mockApps[4];

    render(<AppNavRail layout="taskbar" />);

    expect(screen.getByRole("button", { name: "Feed" })).toHaveAttribute("aria-pressed", "true");
  });

  it("renders taskbar apps in the saved order while keeping profile pinned", () => {
    state.taskbarAppOrder = ["tasks", "agents", "projects", "process", "feed"];

    render(<AppNavRail layout="taskbar" />);

    const labels = within(screen.getByRole("navigation", { name: "Primary navigation" }))
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual(["Tasks", "Agents", "Projects", "Process", "Feed", "Profile"]);
  });

  it("supports splitting taskbar apps into separate clusters", () => {
    render(
      <>
        <AppNavRail layout="taskbar" excludeIds={["profile"]} ariaLabel="Taskbar apps" />
        <AppNavRail layout="taskbar" includeIds={["profile"]} ariaLabel="Profile shortcut" />
      </>,
    );

    const taskbarApps = within(screen.getByRole("navigation", { name: "Taskbar apps" }));
    const profileShortcut = within(screen.getByRole("navigation", { name: "Profile shortcut" }));

    expect(taskbarApps.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(taskbarApps.queryByRole("button", { name: "Profile" })).not.toBeInTheDocument();
    expect(profileShortcut.getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(profileShortcut.queryByRole("button", { name: "Agents" })).not.toBeInTheDocument();
  });

  it("forwards drag reorder events for the reorderable taskbar strip", () => {
    render(<AppNavRail layout="taskbar" allowReorder excludeIds={["profile"]} />);

    const tasksButton = screen.getByRole("button", { name: "Tasks" });
    const buttons = [
      screen.getByRole("button", { name: "Agents" }),
      screen.getByRole("button", { name: "Projects" }),
      tasksButton,
      screen.getByRole("button", { name: "Process" }),
      screen.getByRole("button", { name: "Feed" }),
    ];
    const rects = [
      { left: 0, width: 28 },
      { left: 32, width: 28 },
      { left: 64, width: 28 },
      { left: 96, width: 28 },
      { left: 128, width: 28 },
    ];

    buttons.forEach((button, index) => {
      Object.defineProperty(button, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          x: rects[index].left,
          y: 0,
          top: 0,
          left: rects[index].left,
          right: rects[index].left + rects[index].width,
          bottom: 28,
          width: rects[index].width,
          height: 28,
          toJSON: () => undefined,
        }),
      });
    });

    fireEvent.pointerDown(tasksButton, {
      button: 0,
      pointerId: 1,
      clientX: 78,
      clientY: 10,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 150,
      clientY: 44,
    });

    expect(document.querySelector(".taskbarDragOverlay")).toHaveStyle({ top: "0px" });
    expect(saveTaskbarAppOrder).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: 150,
      clientY: 44,
    });

    expect(saveTaskbarAppOrder).toHaveBeenCalledWith([
      "agents",
      "projects",
      "process",
      "feed",
      "tasks",
    ]);
  });

  it("reuses remembered destinations when taskbar apps are clicked", async () => {
    const user = userEvent.setup();
    navigationMemory.lastProject = "project-1";
    navigationMemory.lastAgent = "agent-9";

    render(<AppNavRail layout="taskbar" />);

    await user.click(screen.getByRole("button", { name: "Projects" }));

    expect(mockNavigate).toHaveBeenCalledWith("/projects/project-1/agents/agent-9");
  });
});
