import { render, screen } from "../../test/render";

vi.mock("@cypher-asi/zui", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

const mockUseAuraCapabilities = vi.fn();
const mockUseProjectContext = vi.fn();

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectContext(),
}));

vi.mock("../../stores/event-store/index", () => ({
  useEventStore: (selector: (state: { connected: boolean }) => unknown) => selector({ connected: true }),
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

vi.mock("./useMobileSpecs", () => ({
  useMobileSpecs: () => ({ specs: [] }),
}));

vi.mock("./useMobileTasks", () => ({
  useMobileTasks: () => ({ tasks: [], tasksBySpec: new Map() }),
}));

vi.mock("../AgentStatusBar", () => ({
  AgentStatusBar: () => <div>Agent status</div>,
}));

vi.mock("../LoopControls", () => ({
  LoopControls: () => <div>Loop controls</div>,
}));

vi.mock("../ExecutionView", () => ({
  ExecutionView: () => <div data-testid="execution-view" />,
}));

vi.mock("../TaskFeed", () => ({
  TaskFeed: () => <div>Task feed</div>,
}));

vi.mock("./ProjectWorkView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProjectWorkView } from "./ProjectWorkView";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseProjectContext.mockReturnValue({
    project: { project_id: "proj-1" },
    initialSpecs: [],
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
    expect(screen.getByText("Task feed")).toBeInTheDocument();
  });
});
