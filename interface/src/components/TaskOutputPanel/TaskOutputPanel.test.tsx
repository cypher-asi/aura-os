import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const clearCompleted = vi.fn();
const addTask = vi.fn();
const completeTask = vi.fn();
const failTask = vi.fn();
const markAllCompleted = vi.fn();
const setActiveId = vi.fn();
const removeTerminal = vi.fn();
const handleStart = vi.fn();
const handlePause = vi.fn();
const handleStop = vi.fn();
const handleStopConfirm = vi.fn();
const setConfirmStop = vi.fn();

let mockTasks = [
  { taskId: "task-1", title: "Active task", status: "active", projectId: "proj-1" },
  { taskId: "task-2", title: "Completed task", status: "completed", projectId: "proj-1" },
];
let projectCtx: { project: { project_id: string } } | null = { project: { project_id: "proj-1" } };
let terminalState = {
  terminals: [
    { id: "term-1", title: "Terminal 1" },
    { id: "term-2", title: "Terminal 2" },
  ],
  activeId: "term-2",
  setActiveId,
  removeTerminal,
};
let automationStatus = {
  status: "idle",
  agentCount: 0,
  canPlay: true,
  canPause: false,
  canStop: false,
  starting: false,
  preparing: false,
  confirmStop: false,
  setConfirmStop,
  handleStart,
  handlePause,
  handleStop,
  handleStopConfirm,
};

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { size?: string }) => (
    <span {...props}>{children}</span>
  ),
  Item: {
    Chevron: ({ onToggle }: { onToggle?: () => void }) => <button onClick={onToggle}>toggle</button>,
  },
  ModalConfirm: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="modal-confirm" /> : null),
  Tabs: ({
    tabs,
    value,
    onChange,
  }: {
    tabs: Array<{ id: string; label: React.ReactNode }>;
    value: string;
    onChange: (id: string) => void;
  }) => (
    <div data-testid="tabs" data-value={value}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("react-router-dom", () => ({
  useParams: () => ({ agentInstanceId: "agent-inst-1" }),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => projectCtx,
}));

vi.mock("../../stores/task-output-panel-store", () => ({
  useTaskOutputPanelStore: Object.assign(
    vi.fn((selector?: (state: { clearCompleted: typeof clearCompleted }) => unknown) =>
      selector ? selector({ clearCompleted }) : { clearCompleted }),
    {
      getState: () => ({ addTask, completeTask, failTask, markAllCompleted }),
    },
  ),
  useTasksForProject: () => mockTasks,
}));

vi.mock("../../stores/terminal-panel-store", () => ({
  useTerminalPanelStore: (selector: (state: typeof terminalState) => unknown) => selector(terminalState),
}));

vi.mock("../AutomationBar/useAutomationStatus", () => ({
  useAutomationStatus: () => automationStatus,
}));

vi.mock("../TerminalPanelBody", () => ({
  TerminalPanelBody: () => <div data-testid="terminal-panel-body" />,
}));

const activeTaskStreamProps = vi.fn<
  (props: {
    taskId: string;
    title?: string;
    scrollRef?: React.RefObject<HTMLDivElement | null>;
    isAutoFollowing?: boolean;
  }) => void
>();

vi.mock("./ActiveTaskStream", () => ({
  ActiveTaskStream: (props: {
    taskId: string;
    title?: string;
    scrollRef?: React.RefObject<HTMLDivElement | null>;
    isAutoFollowing?: boolean;
  }) => {
    activeTaskStreamProps(props);
    return <div data-testid="active-task">{props.title}</div>;
  },
}));

vi.mock("./CompletedTaskOutput", () => ({
  CompletedTaskOutput: ({ title }: { title: string }) => <div data-testid="completed-task">{title}</div>,
}));

vi.mock("./TaskOutputPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { RunSidekickPane, TerminalSidekickPane } from "./TaskOutputPanel";

function setScrollMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
) {
  Object.defineProperties(el, {
    scrollHeight: { value: metrics.scrollHeight, writable: true, configurable: true },
    scrollTop: { value: metrics.scrollTop, writable: true, configurable: true },
    clientHeight: { value: metrics.clientHeight, writable: true, configurable: true },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTasks = [
    { taskId: "task-1", title: "Active task", status: "active", projectId: "proj-1" },
    { taskId: "task-2", title: "Completed task", status: "completed", projectId: "proj-1" },
  ];
  projectCtx = { project: { project_id: "proj-1" } };
  terminalState = {
    terminals: [
      { id: "term-1", title: "Terminal 1" },
      { id: "term-2", title: "Terminal 2" },
    ],
    activeId: "term-2",
    setActiveId,
    removeTerminal,
  };
  automationStatus = {
    status: "idle",
    agentCount: 0,
    canPlay: true,
    canPause: false,
    canStop: false,
    starting: false,
    preparing: false,
    confirmStop: false,
    setConfirmStop,
    handleStart,
    handlePause,
    handleStop,
    handleStopConfirm,
  };
});

describe("RunSidekickPane", () => {
  it("renders run controls inside the run section", async () => {
    const user = userEvent.setup();
    render(<RunSidekickPane />);

    expect(screen.getByRole("button", { name: "Run automation" })).toBeInTheDocument();
    expect(screen.getByTestId("active-task")).toHaveTextContent("Active task");
    expect(screen.getByTestId("completed-task")).toHaveTextContent("Completed task");

    await user.click(screen.getByRole("button", { name: "Clear completed task output" }));
    expect(clearCompleted).toHaveBeenCalled();
  });

  it("wires scrollRef and initial auto-follow state down to active task streams", () => {
    const { container } = render(<RunSidekickPane />);
    const content = container.querySelector(".content");
    expect(content).toBeInstanceOf(HTMLDivElement);

    expect(activeTaskStreamProps).toHaveBeenCalled();
    const props = activeTaskStreamProps.mock.calls.at(-1)?.[0];
    expect(props).toBeDefined();
    expect(props!.scrollRef?.current).toBe(content);
    expect(props!.isAutoFollowing).toBe(true);
  });

  it("unpins isAutoFollowing when the user scrolls away from the bottom", async () => {
    const { container } = render(<RunSidekickPane />);
    const content = container.querySelector(".content") as HTMLDivElement;
    setScrollMetrics(content, {
      scrollHeight: 1000,
      scrollTop: 200,
      clientHeight: 300,
    });

    // The scroll-anchor hook guards the handler for one rAF after its
    // initial mount scroll-to-bottom; flush a frame so our synthetic
    // scroll is actually observed.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    activeTaskStreamProps.mockClear();

    fireEvent.scroll(content);

    await waitFor(() => {
      const latest = activeTaskStreamProps.mock.calls.at(-1)?.[0];
      expect(latest?.isAutoFollowing).toBe(false);
    });
  });
});

describe("TerminalSidekickPane", () => {
  it("renders terminal content without the old new-terminal button", () => {
    render(<TerminalSidekickPane />);

    expect(screen.getByText("Terminal 1")).toBeInTheDocument();
    expect(screen.getByText("Terminal 2")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-panel-body")).toBeInTheDocument();
    expect(screen.queryByTitle("New terminal")).not.toBeInTheDocument();
  });

  it("switches terminal instances from the sidekick view", async () => {
    const user = userEvent.setup();
    render(<TerminalSidekickPane />);

    await user.click(screen.getByRole("button", { name: "Terminal 1" }));
    expect(setActiveId).toHaveBeenCalledWith("term-1");
  });
});
