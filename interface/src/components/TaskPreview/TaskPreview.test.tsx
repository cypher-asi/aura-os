import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Task, TaskId, ProjectId, SpecId, SessionId, AgentInstanceId, TaskStatus } from "../../types";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, title, disabled, onClick, icon, style }: {
    children?: React.ReactNode; title?: string; disabled?: boolean;
    onClick?: () => void; icon?: React.ReactNode; style?: React.CSSProperties;
    variant?: string; size?: string; iconOnly?: boolean;
  }) => (
    <button title={title} disabled={disabled} onClick={onClick} style={style}>{icon}{children}</button>
  ),
  GroupCollapsible: ({ children, label }: { children?: React.ReactNode; label: string; count?: number; defaultOpen?: boolean; className?: string }) => (
    <div data-testid={`group-${label}`}>{label}{children}</div>
  ),
}));

const mockRunTask = vi.fn();
const mockRetryTask = vi.fn();
const mockListAgentInstances = vi.fn();
const mockGetSession = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    runTask: (...args: unknown[]) => mockRunTask(...args),
    retryTask: (...args: unknown[]) => mockRetryTask(...args),
    listAgentInstances: (...args: unknown[]) => mockListAgentInstances(...args),
    getSession: (...args: unknown[]) => mockGetSession(...args),
  },
  isInsufficientCreditsError: () => false,
  dispatchInsufficientCredits: vi.fn(),
}));

const mockSidekickState = {
  pushPreview: vi.fn(),
  setActiveTab: vi.fn(),
};
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

const mockProjectContext = {
  project: { project_id: "proj-1" as ProjectId },
  setProject: vi.fn(),
  message: "",
  handleArchive: vi.fn(),
  navigateToExecution: vi.fn(),
  initialSpecs: [],
  initialTasks: [],
};
vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockProjectContext,
}));

const eventStoreMock = {
  connected: true,
  subscribe: vi.fn(() => vi.fn()),
  seedTaskOutput: vi.fn(),
  taskOutputs: {} as Record<string, unknown>,
};
vi.mock("../../stores/event-store/index", () => ({
  useEventStore: (sel: (s: typeof eventStoreMock) => unknown) => sel(eventStoreMock),
  useTaskOutput: () => ({ text: "", fileOps: [], buildSteps: [], testSteps: [] }),
}));

vi.mock("../../hooks/use-loop-active", () => ({
  useLoopActive: () => false,
}));

let mockLiveStatus: TaskStatus | null = null;
vi.mock("../../hooks/use-task-status", () => ({
  useTaskStatus: () => ({
    liveStatus: mockLiveStatus,
    liveSessionId: null,
    failReason: null,
    setLiveStatus: vi.fn(),
    setFailReason: vi.fn(),
  }),
}));

vi.mock("../../hooks/use-task-agent-instances", () => ({
  useTaskAgentInstances: () => ({ agentInstance: null, completedByAgent: null }),
}));

vi.mock("../../hooks/use-task-output-hydration", () => ({
  useTaskOutputHydration: vi.fn(),
}));

vi.mock("../../hooks/use-task-stream", () => ({
  useTaskStream: () => ({ streamKey: "task:task-1" }),
}));

vi.mock("../VerificationStepItem", () => ({
  VerificationStepItem: () => <div data-testid="verification-step" />,
}));

vi.mock("../TaskMetaSection", () => ({
  TaskMetaSection: (props: Record<string, unknown>) => (
    <div data-testid="task-meta">
      <span data-testid="effective-status">{String(props.effectiveStatus)}</span>
      {props.failReason && <span data-testid="fail-reason">{String(props.failReason)}</span>}
      {props.onRetry && (
        <button onClick={props.onRetry as () => void} data-testid="retry-btn">
          Retry
        </button>
      )}
    </div>
  ),
}));

vi.mock("../TaskFilesSection", () => ({
  TaskFilesSection: ({ fileOps }: { fileOps: { op: string; path: string }[] }) => (
    <div data-testid="task-files">{fileOps.length} files</div>
  ),
}));

vi.mock("../TaskOutputSection", () => ({
  TaskOutputSection: () => <div data-testid="task-output" />,
}));

vi.mock("../../utils/format", () => ({ toBullets: (s: string) => s }));
vi.mock("../../utils/derive-activity", () => ({
  deriveActivity: () => [],
  computeIterationStats: () => null,
}));

vi.mock("../Preview/Preview.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { TaskPreview } from "../TaskPreview";
import { RunTaskButton } from "../RunTaskButton";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: "task-1" as TaskId,
    project_id: "proj-1" as ProjectId,
    spec_id: "spec-1" as SpecId,
    title: "Test task",
    description: "A test task",
    status: "ready" as TaskStatus,
    order_index: 0,
    dependency_ids: [],
    parent_task_id: null,
    assigned_agent_instance_id: null,
    completed_by_agent_instance_id: null,
    session_id: null,
    execution_notes: "",
    files_changed: [],
    build_steps: [],
    test_steps: [],
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  } as Task;
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/projects/proj-1/agents/agent-1"]}>
      <Routes>
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLiveStatus = null;
});

describe("TaskPreview", () => {
  it("renders task meta, files, and output sections", () => {
    renderWithRouter(<TaskPreview task={makeTask()} />);
    expect(screen.getByTestId("task-meta")).toBeInTheDocument();
    expect(screen.getByTestId("task-files")).toBeInTheDocument();
    expect(screen.getByTestId("task-output")).toBeInTheDocument();
  });

  it("shows effective status as ready", () => {
    renderWithRouter(<TaskPreview task={makeTask({ status: "ready" as TaskStatus })} />);
    expect(screen.getByTestId("effective-status")).toHaveTextContent("ready");
  });

  it("shows files_changed count", () => {
    const task = makeTask({
      status: "done" as TaskStatus,
      files_changed: [
        { op: "modify", path: "a.ts" },
        { op: "create", path: "b.ts" },
      ],
    });
    renderWithRouter(<TaskPreview task={task} />);
    expect(screen.getByTestId("task-files")).toHaveTextContent("2 files");
  });

  it("renders retry button via TaskMetaSection", () => {
    renderWithRouter(<TaskPreview task={makeTask({ status: "failed" as TaskStatus })} />);
    expect(screen.getByTestId("retry-btn")).toBeInTheDocument();
  });
});

describe("RunTaskButton", () => {
  it("renders run task button for ready tasks", () => {
    renderWithRouter(<RunTaskButton task={makeTask({ status: "ready" as TaskStatus })} />);
    expect(screen.getByTitle("Run task")).toBeInTheDocument();
  });

  it("calls api.runTask when clicked", async () => {
    const user = userEvent.setup();
    mockRunTask.mockResolvedValue(undefined);
    renderWithRouter(<RunTaskButton task={makeTask({ status: "ready" as TaskStatus })} />);

    await user.click(screen.getByTitle("Run task"));
    await waitFor(() => {
      expect(mockRunTask).toHaveBeenCalledWith("proj-1", "task-1", "agent-1");
    });
  });

  it("hides run button when task is done", () => {
    mockLiveStatus = "done" as TaskStatus;
    renderWithRouter(<RunTaskButton task={makeTask({ status: "done" as TaskStatus })} />);
    expect(screen.getByTitle("Run task")).toHaveStyle({ visibility: "hidden" });
  });
});
