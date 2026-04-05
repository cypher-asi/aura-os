import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Spec, Task, Session, SpecId, TaskId, ProjectId, SessionId, TaskStatus } from "../../types";
import type { PreviewItem } from "../../stores/sidekick-store";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, title, disabled, onClick, icon, ...rest }: Record<string, unknown>) => (
    <button
      title={title as string}
      disabled={disabled as boolean}
      onClick={onClick as () => void}
      aria-label={rest["aria-label"] as string}
    >
      {icon as React.ReactNode}{children as React.ReactNode}
    </button>
  ),
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { size?: string; variant?: string; as?: string; className?: string }) => (
    <span {...props}>{children}</span>
  ),
  GroupCollapsible: ({ children, label }: { children?: React.ReactNode; label: string; count?: number; defaultOpen?: boolean; className?: string }) => (
    <div data-testid={`group-${label}`}>{label}{children}</div>
  ),
  Item: Object.assign(
    ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void; className?: string }) => (
      <div role="button" onClick={onClick}>{children}</div>
    ),
    {
      Icon: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
      Label: ({ children, title }: { children?: React.ReactNode; title?: string }) => <span title={title}>{children}</span>,
    },
  ),
}));

const mockSidekick = {
  previewItem: null as PreviewItem | null,
  closePreview: vi.fn(),
  canGoBack: false,
  goBackPreview: vi.fn(),
  pushPreview: vi.fn(),
};

vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekick) : mockSidekick),
    { getState: () => mockSidekick, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

const mockProjectContext = {
  project: {
    project_id: "proj-1" as ProjectId,
    name: "Test",
    specs_summary: "Summary text",
    specs_title: "My Specs",
  },
};
vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockProjectContext,
}));

vi.mock("../TaskPreview", () => ({
  TaskPreview: ({ task }: { task: Task }) => <div data-testid="task-preview">{task.title}</div>,
}));

vi.mock("../RunTaskButton", () => ({
  RunTaskButton: ({ task }: { task: Task }) => <button data-testid="run-task-btn">{task.title}</button>,
}));

vi.mock("../SessionPreview", () => ({
  SessionPreview: () => <div data-testid="session-preview" />,
}));

vi.mock("../LogPreview", () => ({
  LogPreview: () => <div data-testid="log-preview" />,
}));

vi.mock("../../utils/format", () => ({
  formatRelativeTime: (d: string) => `relative(${d})`,
}));

vi.mock("./Preview.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { PreviewHeader, PreviewContent } from "../Preview";

function makeSpec(overrides: Partial<Spec> = {}): Spec {
  return {
    spec_id: "spec-1" as SpecId,
    project_id: "proj-1" as ProjectId,
    title: "Test Spec",
    order_index: 0,
    markdown_contents: "# Spec\nContent here",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-02T00:00:00Z",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: "task-1" as TaskId,
    project_id: "proj-1" as ProjectId,
    spec_id: "spec-1" as SpecId,
    title: "Test Task",
    description: "desc",
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

function makeSession(): Session {
  return {
    session_id: "sess-12345678" as SessionId,
    agent_instance_id: "ai-1",
    project_id: "proj-1",
    status: "active",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  } as Session;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSidekick.previewItem = null;
  mockSidekick.canGoBack = false;
});

describe("PreviewHeader", () => {
  it("renders nothing when no preview item", () => {
    const { container } = render(<PreviewHeader />);
    expect(container.innerHTML).toBe("");
  });

  it("renders spec title for spec preview", () => {
    mockSidekick.previewItem = { kind: "spec", spec: makeSpec({ title: "Auth spec" }) };
    render(<PreviewHeader />);
    expect(screen.getByText("Auth spec")).toBeInTheDocument();
  });

  it("renders close button", async () => {
    const user = userEvent.setup();
    mockSidekick.previewItem = { kind: "spec", spec: makeSpec() };
    render(<PreviewHeader />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(mockSidekick.closePreview).toHaveBeenCalledOnce();
  });

  it("shows back button when canGoBack is true and not specs_overview", async () => {
    const user = userEvent.setup();
    mockSidekick.canGoBack = true;
    mockSidekick.previewItem = { kind: "spec", spec: makeSpec() };
    render(<PreviewHeader />);

    const backBtn = screen.getByRole("button", { name: "Back" });
    await user.click(backBtn);
    expect(mockSidekick.goBackPreview).toHaveBeenCalledOnce();
  });

  it("hides back button on specs_overview even when canGoBack", () => {
    mockSidekick.canGoBack = true;
    mockSidekick.previewItem = { kind: "specs_overview", specs: [makeSpec()] };
    render(<PreviewHeader />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("renders RunTaskButton for task preview", () => {
    mockSidekick.previewItem = { kind: "task", task: makeTask({ title: "My task" }) };
    render(<PreviewHeader />);
    expect(screen.getByTestId("run-task-btn")).toHaveTextContent("My task");
  });

  it("renders session title correctly", () => {
    mockSidekick.previewItem = { kind: "session", session: makeSession() };
    render(<PreviewHeader />);
    expect(screen.getByText("Session sess-123")).toBeInTheDocument();
  });

  it("shows specs_title for specs_overview", () => {
    mockSidekick.previewItem = { kind: "specs_overview", specs: [makeSpec()] };
    render(<PreviewHeader />);
    expect(screen.getByText("My Specs")).toBeInTheDocument();
  });
});

describe("PreviewContent", () => {
  it("renders spec markdown content", () => {
    mockSidekick.previewItem = { kind: "spec", spec: makeSpec({ title: "Auth" }) };
    render(<PreviewContent />);
    expect(screen.getByText("Auth")).toBeInTheDocument();
  });

  it("renders task preview for task items", () => {
    mockSidekick.previewItem = { kind: "task", task: makeTask({ title: "Build UI" }) };
    render(<PreviewContent />);
    expect(screen.getByTestId("task-preview")).toHaveTextContent("Build UI");
  });

  it("renders session preview for session items", () => {
    mockSidekick.previewItem = { kind: "session", session: makeSession() };
    render(<PreviewContent />);
    expect(screen.getByTestId("session-preview")).toBeInTheDocument();
  });

  it("renders specs overview with summary text", () => {
    mockSidekick.previewItem = { kind: "specs_overview", specs: [makeSpec()] };
    render(<PreviewContent />);
    expect(screen.getByText("Summary text")).toBeInTheDocument();
  });

  it("shows spec count in specs overview", () => {
    mockSidekick.previewItem = { kind: "specs_overview", specs: [makeSpec(), makeSpec({ spec_id: "s2" as SpecId, title: "Spec 2" })] };
    render(<PreviewContent />);
    expect(screen.getByText("Test Spec")).toBeInTheDocument();
    expect(screen.getByText("Spec 2")).toBeInTheDocument();
  });
});
