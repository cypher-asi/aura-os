import { beforeEach, describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

const dismissTask = vi.fn();

interface TaskOutputState {
  text: string;
  fileOps?: { op: string; path: string }[];
  buildSteps?: unknown[];
  testSteps?: unknown[];
  gitSteps?: unknown[];
}

let taskOutputState: TaskOutputState = {
  text: "",
  fileOps: [],
  buildSteps: [],
  testSteps: [],
  gitSteps: [],
};
let streamEventsState: Array<{ id: string; content: string }> = [];

vi.mock("../../stores/event-store/index", () => ({
  useTaskOutput: () => taskOutputState,
  useEventStore: Object.assign(
    vi.fn((selector?: (state: { seedTaskOutput: typeof vi.fn }) => unknown) =>
      selector ? selector({ seedTaskOutput: vi.fn() } as never) : { seedTaskOutput: vi.fn() },
    ),
    {
      getState: () => ({ taskOutputs: {}, seedTaskOutput: vi.fn() }),
    },
  ),
  getCachedTaskOutputText: () => Promise.resolve(""),
}));

vi.mock("../../api/client", () => ({
  api: {
    getTaskOutput: vi.fn().mockResolvedValue({ output: "", build_steps: [], test_steps: [] }),
    listSessionEvents: vi.fn().mockResolvedValue([]),
  },
}));

// The component reads `dismissTask` straight off the selector, while
// `useTaskOutputView` (transitively pulled in) reads the matching
// panel entry to resolve `sessionId` / `agentInstanceId` for the
// session-events rehydrate path. Provide an empty `tasks` list so
// the rehydrate effect short-circuits and never fires in these tests.
vi.mock("../../stores/task-output-panel-store", () => ({
  useTaskOutputPanelStore: vi.fn(
    (selector: (state: { dismissTask: typeof dismissTask; tasks: never[] }) => unknown) =>
      selector({ dismissTask, tasks: [] }),
  ),
}));

vi.mock("../../stores/task-status-store", () => ({
  useTaskStatusStore: vi.fn(
    (selector: (state: { byTaskId: Record<string, never> }) => unknown) =>
      selector({ byTaskId: {} }),
  ),
}));

vi.mock("../../stores/task-output-hydration-cache", () => ({
  hydrateTaskOutputOnce: vi.fn().mockResolvedValue("empty"),
}));

vi.mock("../../stores/task-turn-cache", () => ({
  persistTaskTurns: vi.fn(),
  readTaskTurns: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../hooks/stream/store", () => ({
  seedStreamEventsFromCache: vi.fn(),
}));

vi.mock("../../utils/build-display-messages", () => ({
  buildDisplayEvents: vi.fn().mockReturnValue([]),
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useStreamEvents: () => streamEventsState,
  // Required by `useHydrateContextUtilization`, transitively pulled in
  // by `TaskHeaderContextUsage` now that the task header renders the
  // per-task context-usage pill.
  useIsStreaming: () => false,
}));

// Light render stubs so the body-fallback can assert against the
// step rows without pulling in the heavy real renderers.
vi.mock("../VerificationStepItem", () => ({
  VerificationStepItem: ({
    step,
    variant,
  }: {
    step: { kind: string; command?: string };
    variant: string;
  }) => (
    <div data-testid={`verif-${variant}`} data-kind={step.kind}>
      {step.command ?? variant}
    </div>
  ),
}));

vi.mock("../GitStepItem", () => ({
  GitStepItem: ({ step }: { step: { kind: string; commitSha?: string } }) => (
    <div data-testid="git-step" data-kind={step.kind}>
      {step.commitSha ?? "git"}
    </div>
  ),
}));

vi.mock("../ChatOutput", () => ({
  MessageBubble: ({
    message,
  }: {
    message: { id: string; content: string; errorMessage?: string };
  }) => (
    <div data-testid="message-bubble" data-error={message.errorMessage ?? ""}>
      {message.content}
      {message.errorMessage ? (
        <span data-testid="message-bubble-error">{message.errorMessage}</span>
      ) : null}
    </div>
  ),
  LLMOutput: ({ content }: { content: string }) => (
    <div data-testid="llm-output">{content}</div>
  ),
}));

vi.mock("./TaskOutputPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { CompletedTaskOutput } from "./CompletedTaskOutput";

beforeEach(() => {
  vi.clearAllMocks();
  taskOutputState = {
    text: "",
    fileOps: [],
    buildSteps: [],
    testSteps: [],
    gitSteps: [],
  };
  streamEventsState = [];
});

// Rows are collapsed by default; expand by clicking the header (a
// ListItem `treeitem` row) so the body is visible.
function expandRow() {
  const header = screen.getByRole("treeitem", { expanded: false });
  fireEvent.click(header);
}

describe("CompletedTaskOutput", () => {
  it("renders stream events when available", () => {
    streamEventsState = [{ id: "evt-1", content: "result text" }];
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="completed"
      />,
    );
    expandRow();

    expect(screen.getByTestId("message-bubble")).toHaveTextContent("result text");
  });

  it("falls back to the hydrated task output when there are no stream events", () => {
    taskOutputState = { text: "hydrated output" };
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="completed"
      />,
    );
    expandRow();

    expect(screen.getByTestId("llm-output")).toHaveTextContent("hydrated output");
  });

  it("shows a muted placeholder when no output exists for a completed run", () => {
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="completed"
      />,
    );
    expandRow();

    expect(screen.getByText("No output captured for this run.")).toBeInTheDocument();
  });

  it("shows a failure placeholder when no output exists for a failed run", () => {
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="failed"
      />,
    );
    expandRow();

    expect(screen.getByText("Task failed without producing output.")).toBeInTheDocument();
  });

  it("renders the synthetic failure event in place of the empty-state copy when finalize emitted one", () => {
    // After the lifecycle fix, every `task_failed` produces a
    // synthetic assistant-message event carrying the failure reason
    // in `errorMessage` (and, when text never streamed, the live
    // progress label as content). The Run pane row must surface that
    // structured event via MessageBubble instead of collapsing to
    // the generic "Task failed without producing output." copy.
    streamEventsState = [
      {
        id: "stream-fail-1",
        content: "_was: Submitting plan…_",
        // The synthetic event lives alongside other DisplaySessionEvent
        // fields; the mock above pulls `errorMessage` through.
        errorMessage: "upstream returned 503",
      } as never,
    ];

    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="failed"
      />,
    );
    expandRow();

    expect(screen.queryByText("Task failed without producing output.")).not.toBeInTheDocument();
    const bubble = screen.getByTestId("message-bubble");
    expect(bubble).toHaveTextContent("_was: Submitting plan…_");
    expect(screen.getByTestId("message-bubble-error")).toHaveTextContent(
      "upstream returned 503",
    );
  });

  it("renders the failure reason banner when one is available", () => {
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="failed"
        failureReason="Task modified source code but no build step was run"
      />,
    );
    expandRow();

    expect(
      screen.getByText("Task modified source code but no build step was run"),
    ).toBeInTheDocument();
    // The generic fallback copy should not render once a reason exists -
    // the banner is the explanation.
    expect(
      screen.queryByText("Task failed without producing output."),
    ).not.toBeInTheDocument();
  });

  it("extracts the inner message from JSON-wrapped failure reasons", () => {
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="failed"
        failureReason={'ApiError: {"message": "overloaded_error"}'}
      />,
    );
    expandRow();

    expect(screen.getByText("overloaded_error")).toBeInTheDocument();
  });

  it("ignores a failureReason on non-failed rows", () => {
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="completed"
        failureReason="should not appear"
      />,
    );
    expandRow();

    expect(screen.queryByText("should not appear")).not.toBeInTheDocument();
  });

  it("renders a compact provider context label when failureContext is present", () => {
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="failed"
        failureReason="stream terminated"
        failureContext={{
          providerRequestId: "req_01ABC",
          model: "claude-sonnet-4",
          sseErrorType: "api_error",
          messageId: "msg_01",
        }}
      />,
    );
    expandRow();

    const label = screen.getByTestId("task-failure-context");
    expect(label).toHaveTextContent("req=req_01ABC · claude-sonnet-4 · api_error");
    // message_id is intentionally excluded from the compact label (it's
    // an internal provider id; request_id is the operator-facing one).
    expect(label).not.toHaveTextContent("msg_01");
  });

  it("omits the provider context label when no fields are populated", () => {
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="failed"
        failureReason="stream terminated"
        failureContext={{}}
      />,
    );
    expandRow();

    expect(screen.queryByTestId("task-failure-context")).not.toBeInTheDocument();
  });

  it("renders a partial provider context label when only one field is set", () => {
    render(
      <CompletedTaskOutput
        taskId="task-1"
        projectId="proj-1"
        title="My task"
        status="failed"
        failureReason="stream terminated"
        failureContext={{ providerRequestId: "req_only" }}
      />,
    );
    expandRow();

    expect(screen.getByTestId("task-failure-context")).toHaveTextContent(
      "req=req_only",
    );
  });

  describe("virtualization", () => {
    it("uses the virtualized events body when a scrollRef is provided", () => {
      // The task preview overlay passes its `.previewBody` ref down so
      // very long histories window their MessageBubble rows instead of
      // mounting every subtree at once. Routing is structural: when a
      // ref is present the body container picks up the `taskBodyVirtual`
      // class (and the absolute-positioned row wrappers under it),
      // even before TanStack Virtual has measured anything.
      streamEventsState = [
        { id: "evt-1", content: "first turn" },
        { id: "evt-2", content: "second turn" },
      ];

      const scrollRef = createRef<HTMLDivElement>();
      const { container } = render(
        <div ref={scrollRef} style={{ overflow: "auto", height: 200 }}>
          <CompletedTaskOutput
            taskId="task-1"
            projectId="proj-1"
            title="My task"
            status="completed"
            scrollRef={scrollRef}
          />
        </div>,
      );
      expandRow();

      const virtualBody = container.querySelector(".taskBodyVirtual");
      expect(virtualBody).not.toBeNull();
    });

    it("renders the plain mapped events body when scrollRef is absent", () => {
      // The Run pane mounts each task row with its own internal scroll
      // and doesn't share `.previewBody`, so it omits `scrollRef`. The
      // plain `.map()` rendering must still apply there so today's
      // Run pane layout is unaffected by the virtualization changes.
      streamEventsState = [{ id: "evt-1", content: "first turn" }];

      const { container } = render(
        <CompletedTaskOutput
          taskId="task-1"
          projectId="proj-1"
          title="My task"
          status="completed"
        />,
      );
      expandRow();

      expect(container.querySelector(".taskBodyVirtual")).toBeNull();
      expect(screen.getByTestId("message-bubble")).toHaveTextContent("first turn");
    });
  });

  describe("steps fallback", () => {
    it("renders build / test / git step rows when no events or text are available", () => {
      // Reproduces the production bug where a `cargo build` task
      // ends with structured `build_steps` populated but no
      // assistant turn text — without the body fallback the row
      // collapsed to "No output captured." and the user lost the
      // verification result.
      taskOutputState = {
        text: "",
        buildSteps: [
          { kind: "passed", command: "cargo build", timestamp: 0 },
        ],
        testSteps: [
          { kind: "failed", command: "cargo test", timestamp: 0 },
        ],
        gitSteps: [
          { kind: "committed", commitSha: "abc1234", timestamp: 0 },
        ],
      };

      render(
        <CompletedTaskOutput
          taskId="task-1"
          projectId="proj-1"
          title="My task"
          status="completed"
        />,
      );
      expandRow();

      // None of the empty-state copies should render now.
      expect(
        screen.queryByText("No output captured for this run."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("No text output captured for this run."),
      ).not.toBeInTheDocument();

      expect(screen.getByTestId("verif-build")).toHaveTextContent(
        "cargo build",
      );
      expect(screen.getByTestId("verif-test")).toHaveTextContent("cargo test");
      expect(screen.getByTestId("git-step")).toHaveTextContent("abc1234");
    });

    it("falls back to the empty-state copy when showStepsFallback is false", () => {
      // The Tasks-tab `TaskPreview` already shows dedicated
      // verification sections above the embedded `CompletedTaskOutput`,
      // so it passes `showStepsFallback={false}` to suppress the body
      // duplication. Verify the prop is honoured.
      taskOutputState = {
        text: "",
        buildSteps: [
          { kind: "passed", command: "cargo build", timestamp: 0 },
        ],
        testSteps: [],
        gitSteps: [],
      };

      render(
        <CompletedTaskOutput
          taskId="task-1"
          projectId="proj-1"
          title="My task"
          status="completed"
          showStepsFallback={false}
        />,
      );
      expandRow();

      expect(screen.queryByTestId("verif-build")).not.toBeInTheDocument();
      // hasAnyContent is true (buildSteps.length > 0), so the
      // placeholder reads "No text output captured for this run."
      // — the more specific copy for "we have steps but no text".
      expect(
        screen.getByText("No text output captured for this run."),
      ).toBeInTheDocument();
    });
  });
});
