import { render, screen } from "../../test/render";

vi.mock("@cypher-asi/zui", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  ModalConfirm: () => null,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

const mockUseAuraCapabilities = vi.fn();
const mockUseProjectContext = vi.fn();
const mockGetLastAgent = vi.fn();
const mockUseMobileTasks = vi.fn();

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectContext(),
}));

vi.mock("../../stores/event-store/index", () => ({
  useEventStore: (selector: (state: { connected: boolean }) => unknown) => selector({ connected: true }),
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: {
    agentsByProject: Record<string, Array<{
      agent_instance_id: string;
      name: string;
      role?: string;
    }>>;
  }) => unknown) => selector({
    agentsByProject: {
      "proj-1": [
        { agent_instance_id: "agent-a", name: "MOT Local", role: "Remote Aura agent" },
        { agent_instance_id: "agent-b", name: "AtlasE2E0415", role: "MobileE2EValidator" },
      ],
    },
  }),
}));

vi.mock("../../utils/storage", () => ({
  getLastAgent: (...args: unknown[]) => mockGetLastAgent(...args),
}));

vi.mock("../../hooks/use-loop-control", () => ({
  useLoopControl: () => ({
    loopRunning: false,
    loopPaused: false,
    error: null,
    handleStart: vi.fn(),
    handlePause: vi.fn(),
    handleStop: vi.fn(),
  }),
}));

const mockSidekickState = {
  viewSpec: vi.fn(),
  viewTask: vi.fn(),
};
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("../../mobile/hooks/useMobileSpecs", () => ({
  useMobileSpecs: () => ({ specs: [] }),
}));

vi.mock("../../mobile/hooks/useMobileTasks", () => ({
  useMobileTasks: (projectId: string) => mockUseMobileTasks(projectId),
}));

vi.mock("../AgentStatusBar", () => ({
  AgentStatusBar: () => <div>Agent status</div>,
}));

vi.mock("../ExecutionView", () => ({
  ExecutionView: () => <div data-testid="execution-view" />,
}));

vi.mock("../../components/TaskStatusIcon", () => ({
  TaskStatusIcon: ({ status }: { status: string }) => <span data-testid={`task-status-${status}`} />,
}));

vi.mock("./ProjectWorkView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectWorkView } from "./ProjectWorkView";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLastAgent.mockReturnValue(null);
  mockUseProjectContext.mockReturnValue({
    project: { project_id: "proj-1" },
    initialSpecs: [{ spec_id: "spec-1", title: "Spec One" }],
  });
  mockUseMobileTasks.mockReturnValue({
    tasks: [{
      task_id: "task-1",
      project_id: "proj-1",
      spec_id: "spec-1",
      title: "Patch auth flow",
      description: "Fix the login handoff",
      status: "ready",
      order_index: 0,
      dependency_ids: [],
      parent_task_id: null,
      assigned_agent_instance_id: "agent-a",
      completed_by_agent_instance_id: null,
      session_id: null,
      execution_notes: "",
      files_changed: [],
      live_output: "",
      total_input_tokens: 0,
      total_output_tokens: 0,
      created_at: "2026-03-17T01:00:00.000Z",
      updated_at: "2026-03-17T01:00:00.000Z",
    }],
    tasksBySpec: new Map(),
    liveTaskIds: new Set<string>(),
    loopActive: false,
  });
});

describe("ProjectWorkView", () => {
  it("keeps the desktop execution view unchanged", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    render(<ProjectWorkView />);

    expect(screen.getByTestId("execution-view")).toBeInTheDocument();
    expect(screen.queryByTestId("group-Stats")).not.toBeInTheDocument();
  });

  it("keeps the mobile work flow focused on execution and specs", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    render(<ProjectWorkView />);

    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("Specs")).toBeInTheDocument();
    expect(screen.queryByText("Log panel")).not.toBeInTheDocument();
    expect(screen.queryByText("Task Feed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Patch auth flow" })).toBeInTheDocument();
    expect(screen.getByText("Up next • Spec One")).toBeInTheDocument();
  });

  it("uses the remembered current agent in the mobile execution summary", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
    mockGetLastAgent.mockReturnValue("agent-b");

    render(<ProjectWorkView />);

    expect(screen.getByText("AtlasE2E0415")).toBeInTheDocument();
    expect(screen.getByText("MobileE2EValidator")).toBeInTheDocument();
    expect(screen.queryByText("MOT Local")).not.toBeInTheDocument();
  });

  it("shows a mobile-first empty state when there is no recent activity yet", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });
    mockUseMobileTasks.mockReturnValue({
      tasks: [],
      tasksBySpec: new Map(),
      liveTaskIds: new Set<string>(),
      loopActive: false,
    });

    render(<ProjectWorkView />);

    expect(screen.getByText("No recent work yet")).toBeInTheDocument();
    expect(screen.getByText("Start the loop to see live task progress and planning activity here.")).toBeInTheDocument();
  });
});
