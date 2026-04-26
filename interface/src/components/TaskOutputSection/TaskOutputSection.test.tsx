import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplaySessionEvent, ToolCallEntry, TimelineItem } from "../../shared/types/stream";
import type { Task } from "../../shared/types";
import {
  TaskOutputSection,
  renderCooldownMessage,
  formatDebugOutput,
  type DebugContext,
} from "./TaskOutputSection";

const cooldownState = {
  paused: false,
  remainingSeconds: null as number | null,
  retryKind: null as string | null,
  reason: null as string | null,
  taskId: null as string | null,
};

vi.mock("../../hooks/use-cooldown-status", () => ({
  useCooldownStatus: () => cooldownState,
  cooldownLabel: (k: string | null) => {
    if (k === "provider_rate_limited") return "Rate limited by provider";
    if (k === null) return "Paused";
    return k;
  },
}));

const streamState = {
  events: [] as DisplaySessionEvent[],
  isStreaming: false,
  streamingText: "",
  thinkingText: "",
  thinkingDurationMs: null as number | null,
  activeToolCalls: [] as ToolCallEntry[],
  timeline: [] as TimelineItem[],
  progressText: "",
};

vi.mock("@cypher-asi/zui", () => ({
  GroupCollapsible: ({ children, label }: { children?: React.ReactNode; label: string }) => (
    <div data-testid={`group-${label}`}>{children}</div>
  ),
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useStreamEvents: () => streamState.events,
  useIsStreaming: () => streamState.isStreaming,
  useIsWriting: () => false,
  useStreamingText: () => streamState.streamingText,
  useThinkingText: () => streamState.thinkingText,
  useThinkingDurationMs: () => streamState.thinkingDurationMs,
  useActiveToolCalls: () => streamState.activeToolCalls,
  useTimeline: () => streamState.timeline,
  useProgressText: () => streamState.progressText,
}));

vi.mock("../../stores/event-store/index", () => ({
  useTaskOutput: () => ({ text: "", fileOps: [], buildSteps: [], testSteps: [], gitSteps: [] }),
  useEventStore: (selector: (s: { seedTaskOutput: () => void }) => unknown) =>
    selector({ seedTaskOutput: () => {} }),
  getCachedTaskOutputText: () => undefined,
}));

vi.mock("../../hooks/use-task-output-view", () => ({
  useTaskOutputView: () => ({
    streamKey: "task:1",
    events: [],
    taskOutput: { text: "", fileOps: [], buildSteps: [], testSteps: [], gitSteps: [] },
    fallbackText: "",
    hasStructuredContent: false,
    hasAnyContent: false,
  }),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => null,
}));

vi.mock("../ChatOutput", () => ({
  MessageBubble: ({
    message,
    isStreaming,
  }: {
    message: DisplaySessionEvent;
    isStreaming?: boolean;
  }) => (
    <div
      data-testid="message-bubble"
      data-message-id={message.id}
      data-streaming={isStreaming ? "true" : "false"}
    />
  ),
  StreamingBubble: ({ showPhaseIndicator }: { showPhaseIndicator?: boolean }) => (
    <div
      data-testid="streaming-bubble"
      data-show-phase-indicator={String(showPhaseIndicator)}
    />
  ),
}));

vi.mock("../Preview/Preview.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("TaskOutputSection", () => {
  beforeEach(() => {
    streamState.events = [];
    streamState.isStreaming = false;
    streamState.streamingText = "";
    streamState.thinkingText = "";
    streamState.thinkingDurationMs = null;
    streamState.activeToolCalls = [];
    streamState.timeline = [];
    streamState.progressText = "";
    cooldownState.paused = false;
    cooldownState.remainingSeconds = null;
    cooldownState.retryKind = null;
    cooldownState.reason = null;
    cooldownState.taskId = null;
  });

  it("keeps placeholder assistant messages on the streaming-safe render path", () => {
    streamState.isStreaming = true;
    streamState.events = [
      {
        id: "stream-123",
        role: "assistant",
        content: "Pending final output",
      },
    ];

    render(<TaskOutputSection isActive streamKey="task:1" />);

    expect(screen.getByTestId("message-bubble")).toHaveAttribute("data-streaming", "true");
  });

  it("does not render a live streaming bubble when only the isStreaming flag remains", () => {
    streamState.isStreaming = true;
    streamState.events = [
      {
        id: "stream-123",
        role: "assistant",
        content: "Final streamed text",
      },
    ];

    render(<TaskOutputSection isActive streamKey="task:1" />);

    expect(screen.queryByTestId("streaming-bubble")).not.toBeInTheDocument();
    expect(screen.queryByText("Waiting for agent output…")).not.toBeInTheDocument();
  });

  it("pins the streaming phase indicator outside the live streaming bubble", () => {
    streamState.isStreaming = true;
    streamState.streamingText = "Working through the task";

    render(<TaskOutputSection isActive streamKey="task:1" />);

    expect(screen.getByTestId("streaming-bubble")).toHaveAttribute(
      "data-show-phase-indicator",
      "false",
    );
    expect(screen.getByText("Cooking...")).toBeInTheDocument();
  });

  it("shows cooldown countdown instead of 'Waiting for agent output…' while paused", () => {
    cooldownState.paused = true;
    cooldownState.retryKind = "provider_rate_limited";
    cooldownState.remainingSeconds = 49;

    render(<TaskOutputSection isActive streamKey="task:1" />);

    expect(screen.queryByText("Waiting for agent output…")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Rate limited by provider — resuming in 49s/),
    ).toBeInTheDocument();
  });

  it("falls back to 'Waiting for agent output…' when no cooldown is active", () => {
    render(<TaskOutputSection isActive streamKey="task:1" />);
    expect(screen.getByText("Waiting for agent output…")).toBeInTheDocument();
  });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: "task-1",
    project_id: "project-1",
    spec_id: "spec-1",
    title: "Sample task",
    description: "",
    status: "failed",
    order_index: 0,
    dependency_ids: [],
    parent_task_id: null,
    assigned_agent_instance_id: null,
    completed_by_agent_instance_id: null,
    session_id: null,
    execution_notes: "",
    files_changed: [],
    live_output: "",
    build_steps: [],
    test_steps: [],
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: "2026-04-24T00:00:00Z",
    updated_at: "2026-04-24T00:00:00Z",
    ...overrides,
  } as Task;
}

function makeDebugContext(overrides: Partial<DebugContext> = {}): DebugContext {
  return {
    task: makeTask(),
    events: [],
    streamingText: "",
    thinkingText: "",
    fallbackText: "",
    activeToolCalls: [],
    taskOutput: {
      text: "",
      fileOps: [],
      buildSteps: [],
      testSteps: [],
      gitSteps: [],
    } as DebugContext["taskOutput"],
    failReason: null,
    ...overrides,
  };
}

describe("formatDebugOutput", () => {
  it("includes a Fail Reason section when failReason is set", () => {
    const output = formatDebugOutput(
      makeDebugContext({
        failReason: "completion contract: task_done with no file changes",
      }),
    );
    expect(output).toContain("## Fail Reason");
    expect(output).toContain(
      "completion contract: task_done with no file changes",
    );
  });

  // Once the server persists the reason to `execution_notes` and the
  // hook seeds `failReason` from it on reload, both fields carry the
  // same string. Rendering both sections duplicates the paragraph in
  // the clipboard, which is noise. The formatter skips the Execution
  // Notes section in that case.
  it("omits Execution Notes when it matches failReason exactly", () => {
    const reason = "task_done called without file changes";
    const output = formatDebugOutput(
      makeDebugContext({
        failReason: reason,
        task: makeTask({ execution_notes: reason }),
      }),
    );
    expect(output).toContain("## Fail Reason");
    expect(output).toContain(reason);
    expect(output).not.toContain("## Execution Notes");
  });

  it("still renders Execution Notes when it carries distinct content", () => {
    const output = formatDebugOutput(
      makeDebugContext({
        failReason: "connection reset by peer",
        task: makeTask({
          execution_notes: "retry attempt 3/3 exhausted after cooldown",
        }),
      }),
    );
    expect(output).toContain("## Fail Reason");
    expect(output).toContain("connection reset by peer");
    expect(output).toContain("## Execution Notes");
    expect(output).toContain("retry attempt 3/3 exhausted after cooldown");
  });

  it("renders Execution Notes when failReason is null (no live event)", () => {
    const output = formatDebugOutput(
      makeDebugContext({
        failReason: null,
        task: makeTask({ execution_notes: "persisted reason from the db" }),
      }),
    );
    expect(output).toContain("## Execution Notes");
    expect(output).toContain("persisted reason from the db");
  });

  it("treats whitespace-only execution_notes as empty", () => {
    const output = formatDebugOutput(
      makeDebugContext({
        failReason: "real reason",
        task: makeTask({ execution_notes: "   " }),
      }),
    );
    expect(output).toContain("## Fail Reason");
    expect(output).not.toContain("## Execution Notes");
  });
});

describe("renderCooldownMessage", () => {
  it("includes the remaining seconds when known", () => {
    expect(
      renderCooldownMessage({ retryKind: "provider_rate_limited", remainingSeconds: 30 }),
    ).toBe("Rate limited by provider — resuming in 30s…");
  });

  it("omits countdown when remainingSeconds is zero", () => {
    expect(
      renderCooldownMessage({ retryKind: "provider_rate_limited", remainingSeconds: 0 }),
    ).toBe("Rate limited by provider — resuming…");
  });

  it("handles missing retry_kind gracefully", () => {
    expect(renderCooldownMessage({ retryKind: null, remainingSeconds: null })).toBe(
      "Paused — resuming…",
    );
  });
});
