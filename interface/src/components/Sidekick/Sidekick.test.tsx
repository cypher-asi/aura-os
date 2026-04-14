import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, title, disabled, onClick, icon, selected, ...rest }: Record<string, unknown>) => (
    <button
      title={title as string}
      disabled={disabled as boolean}
      onClick={onClick as () => void}
      aria-label={rest["aria-label"] as string}
      aria-pressed={rest["aria-pressed"] as string}
    >
      {icon as React.ReactNode}{children as React.ReactNode}
    </button>
  ),
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { size?: string; variant?: string; as?: string }) => (
    <span {...props}>{children}</span>
  ),
  Menu: () => <div data-testid="menu" />,
}));

const mockSidekick = {
  activeTab: "tasks" as string,
  setActiveTab: vi.fn(),
  showInfo: false,
  toggleInfo: vi.fn(),
  previewItem: null as unknown,
  closePreview: vi.fn(),
  canGoBack: false,
  goBackPreview: vi.fn(),
  streamingAgentInstanceId: null as string | null,
};

vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekick) : mockSidekick),
    { getState: () => mockSidekick, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

const mockProjectContext = {
  project: {
    project_id: "proj-1",
    name: "Test Project",
    current_status: "active",
    created_at: "2025-01-01T00:00:00Z",
  },
  setProject: vi.fn(),
  message: "",
  handleArchive: vi.fn(),
  navigateToExecution: vi.fn(),
  initialSpecs: [],
  initialTasks: [],
};
let projectCtx: typeof mockProjectContext | null = mockProjectContext;
const addTerminal = vi.fn();
vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => projectCtx,
}));

vi.mock("../../stores/terminal-panel-store", () => ({
  useTerminalPanelStore: (selector: (s: { addTerminal: typeof addTerminal }) => unknown) =>
    selector({ addTerminal }),
}));

let linkedWorkspace = true;
vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    features: { linkedWorkspace },
  }),
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ projectId: "proj-1", agentInstanceId: "agent-inst-1" }),
}));

vi.mock("../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => ({
    remoteAgentId: undefined,
    remoteWorkspacePath: undefined,
    workspacePath: "/test/path",
    status: "ready",
  }),
}));

vi.mock("../../hooks/use-click-outside", () => ({
  useClickOutside: vi.fn(),
}));

vi.mock("../AutomationBar", () => ({
  AutomationBar: () => <div data-testid="automation-bar" />,
}));
vi.mock("../StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock("../EmptyState", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => <div data-testid="empty-state">{children}</div>,
}));
vi.mock("../PanelSearch", () => ({
  PanelSearch: () => <div data-testid="panel-search" />,
}));
vi.mock("../FileExplorer", () => ({
  FileExplorer: () => <div data-testid="file-explorer" />,
}));
vi.mock("../TaskOutputPanel", () => ({
  RunSidekickPane: () => <div data-testid="run-sidekick-pane" />,
  TerminalSidekickPane: () => <div data-testid="terminal-sidekick-pane" />,
  useActiveTaskTracking: vi.fn(),
}));
vi.mock("../../views/SpecList", () => ({
  SpecList: () => <div data-testid="spec-list" />,
}));
vi.mock("../../views/TaskList", () => ({
  TaskList: () => <div data-testid="task-list" />,
}));
vi.mock("../../views/StatsDashboard", () => ({
  StatsDashboard: () => <div data-testid="stats-dashboard" />,
}));
vi.mock("../../views/SessionList", () => ({
  SessionList: () => <div data-testid="session-list" />,
}));
vi.mock("../../views/SidekickLog", () => ({
  SidekickLog: () => <div data-testid="sidekick-log" />,
}));

vi.mock("./Sidekick.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { SidekickHeader, SidekickTaskbar, SidekickContent } from "../Sidekick";

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  vi.clearAllMocks();
  projectCtx = mockProjectContext;
  mockSidekick.activeTab = "tasks";
  mockSidekick.showInfo = false;
  linkedWorkspace = true;
  addTerminal.mockClear();
});

describe("SidekickHeader", () => {
  it("renders AutomationBar when context is available", () => {
    render(<SidekickHeader />);
    expect(screen.getByTestId("automation-bar")).toBeInTheDocument();
  });

  it("renders nothing when no project context", () => {
    projectCtx = null;
    const { container } = render(<SidekickHeader />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when showInfo is true", () => {
    mockSidekick.showInfo = true;
    const { container } = render(<SidekickHeader />);
    expect(container.innerHTML).toBe("");
  });
});

describe("SidekickTaskbar", () => {
  it("renders top-bar buttons in the new order", () => {
    render(<SidekickTaskbar />);
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.getAttribute("title"));

    expect(labels.slice(0, 9)).toEqual([
      "Terminal",
      "Run",
      "Specs",
      "Tasks",
      "Stats",
      "Log",
      "Sessions",
      "Files",
      "New terminal",
    ]);
  });

  it("calls setActiveTab when a tab is clicked", async () => {
    const user = userEvent.setup();
    render(<SidekickTaskbar />);

    await user.click(screen.getByRole("button", { name: "Terminal" }));
    expect(mockSidekick.setActiveTab).toHaveBeenCalledWith("terminal");
  });

  it("creates a terminal from the inline plus button", async () => {
    const user = userEvent.setup();
    render(<SidekickTaskbar />);

    await user.click(screen.getByRole("button", { name: "New terminal" }));
    expect(addTerminal).toHaveBeenCalled();
    expect(mockSidekick.setActiveTab).toHaveBeenCalledWith("terminal");
  });

  it("marks active tab as pressed", () => {
    mockSidekick.activeTab = "run";
    render(<SidekickTaskbar />);
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Terminal" })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders nothing when no project context", () => {
    projectCtx = null;
    render(<SidekickTaskbar />);
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("renders More actions button", () => {
    render(<SidekickTaskbar />);
    expect(screen.getByRole("button", { name: "More actions" })).toBeInTheDocument();
  });

  it("rerenders cleanly when project info is toggled", () => {
    const { container, rerender } = render(<SidekickTaskbar />);

    expect(container.innerHTML).not.toBe("");

    mockSidekick.showInfo = true;
    expect(() => rerender(<SidekickTaskbar />)).not.toThrow();
    expect(container.innerHTML).toBe("");

    mockSidekick.showInfo = false;
    expect(() => rerender(<SidekickTaskbar />)).not.toThrow();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
  });
});

describe("SidekickContent", () => {
  it("shows empty state when no project context", () => {
    projectCtx = null;
    render(<SidekickContent />);
    expect(screen.getByText("Select a project to get started")).toBeInTheDocument();
  });

  it("renders task list for tasks tab", () => {
    mockSidekick.activeTab = "tasks";
    render(<SidekickContent />);
    expect(screen.getByTestId("task-list")).toBeInTheDocument();
  });

  it("does not mount inactive log content", () => {
    mockSidekick.activeTab = "tasks";
    render(<SidekickContent />);
    expect(screen.queryByTestId("sidekick-log")).not.toBeInTheDocument();
  });

  it("renders spec list for specs tab", () => {
    mockSidekick.activeTab = "specs";
    render(<SidekickContent />);
    expect(screen.getByTestId("spec-list")).toBeInTheDocument();
  });

  it("renders stats dashboard for stats tab", () => {
    mockSidekick.activeTab = "stats";
    render(<SidekickContent />);
    expect(screen.getByTestId("stats-dashboard")).toBeInTheDocument();
  });

  it("renders run pane for run tab", () => {
    mockSidekick.activeTab = "run";
    render(<SidekickContent />);
    expect(screen.getByTestId("run-sidekick-pane")).toBeInTheDocument();
  });

  it("renders terminal pane for terminal tab", () => {
    mockSidekick.activeTab = "terminal";
    render(<SidekickContent />);
    expect(screen.getByTestId("terminal-sidekick-pane")).toBeInTheDocument();
  });

  it("renders session list for sessions tab", () => {
    mockSidekick.activeTab = "sessions";
    render(<SidekickContent />);
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("renders sidekick log for log tab", () => {
    mockSidekick.activeTab = "log";
    render(<SidekickContent />);
    expect(screen.getByTestId("sidekick-log")).toBeInTheDocument();
  });

  it("renders search bar except on stats tab", () => {
    mockSidekick.activeTab = "tasks";
    render(<SidekickContent />);
    expect(screen.getByTestId("panel-search")).toBeInTheDocument();
  });

  it("hides search on stats tab", () => {
    mockSidekick.activeTab = "stats";
    render(<SidekickContent />);
    expect(screen.queryByTestId("panel-search")).not.toBeInTheDocument();
  });

  it("hides search on run tab", () => {
    mockSidekick.activeTab = "run";
    render(<SidekickContent />);
    expect(screen.queryByTestId("panel-search")).not.toBeInTheDocument();
  });

  it("shows info panel when showInfo is true", () => {
    mockSidekick.showInfo = true;
    render(<SidekickContent />);
    expect(screen.getByText("Project Info")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });
});
