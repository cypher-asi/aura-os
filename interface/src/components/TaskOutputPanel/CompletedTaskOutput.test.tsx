import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const dismissTask = vi.fn();

let taskOutputState: { text: string; buildSteps?: unknown[]; testSteps?: unknown[] } = {
  text: "",
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
  getCachedTaskOutputText: () => null,
}));

vi.mock("../../api/client", () => ({
  api: {
    getTaskOutput: vi.fn().mockResolvedValue({ output: "", build_steps: [], test_steps: [] }),
  },
}));

vi.mock("../../stores/task-output-panel-store", () => ({
  useTaskOutputPanelStore: vi.fn((selector: (state: { dismissTask: typeof dismissTask }) => unknown) =>
    selector({ dismissTask }),
  ),
}));

vi.mock("../../stores/task-output-hydration-cache", () => ({
  hydrateTaskOutputOnce: vi.fn().mockResolvedValue("empty"),
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useStreamEvents: () => streamEventsState,
}));

vi.mock("../MessageBubble", () => ({
  MessageBubble: ({ message }: { message: { id: string; content: string } }) => (
    <div data-testid="message-bubble">{message.content}</div>
  ),
}));

vi.mock("../LLMOutput", () => ({
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
  taskOutputState = { text: "" };
  streamEventsState = [];
});

// Rows are collapsed by default; expand by clicking the header so the
// body actually renders in the DOM.
function expandRow() {
  const header = screen.getByRole("button", { expanded: false });
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
});
