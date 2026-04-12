import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockNavigate = vi.fn();

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
};

const navigationMemory = {
  lastSelectedAgentId: null as string | null,
  lastProject: null as string | null,
  lastAgent: null as string | null,
};

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../stores/app-store", () => ({
  useAppStore: (selector: (s: typeof state) => unknown) => selector(state),
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

    expect(screen.getByRole("button", { name: "Feed" }).className).toContain("navBtnSelected");
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
