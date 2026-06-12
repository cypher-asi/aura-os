import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ToolCallEntry } from "../../shared/types/stream";

// --- Stream hook mocks. These are the only knobs the placeholder gate
//     depends on, so each test sets them via the `streamState` object.

interface StreamState {
  isStreaming: boolean;
  streamingText: string;
  thinkingText: string;
  activeToolCalls: ToolCallEntry[];
}

let streamState: StreamState = {
  isStreaming: true,
  streamingText: "",
  thinkingText: "",
  activeToolCalls: [],
};

vi.mock("../../hooks/use-task-stream", () => ({
  useTaskStream: () => ({ streamKey: "task:test-task" }),
}));

vi.mock("../../hooks/stream/hooks", () => ({
  useIsStreaming: () => streamState.isStreaming,
  useIsWriting: () => false,
  useStreamingText: () => streamState.streamingText,
  useThinkingText: () => streamState.thinkingText,
  useThinkingDurationMs: () => null,
  useActiveToolCalls: () => streamState.activeToolCalls,
  useTimeline: () => [],
  useProgressText: () => "",
  useStreamEvents: () => [],
}));

// `useTaskOutputView` (pulled in transitively) selects `seedTaskOutput`
// and `connected` off the event store; `connected: false` keeps every
// server-rehydration effect short-circuited for these non-terminal rows.
vi.mock("../../stores/event-store/index", () => {
  const state = {
    seedTaskOutput: vi.fn(),
    connected: false,
    taskOutputs: {},
  };
  return {
    useTaskOutput: () => ({
      text: "",
      fileOps: [],
      buildSteps: [],
      testSteps: [],
      gitSteps: [],
    }),
    useEventStore: Object.assign(
      vi.fn((selector?: (s: typeof state) => unknown) =>
        selector ? selector(state) : state,
      ),
      { getState: () => state },
    ),
    getCachedTaskOutputText: () => Promise.resolve(""),
  };
});

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

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => ({ project: { project_id: "proj-1" } }),
}));

interface CooldownState {
  paused: boolean;
  retryKind: string | null;
  remainingSeconds: number | null;
}

let cooldownState: CooldownState = {
  paused: false,
  retryKind: null,
  remainingSeconds: null,
};

vi.mock("../../hooks/use-cooldown-status", () => ({
  useCooldownStatus: () => cooldownState,
  renderCooldownMessage: (c: { retryKind: string | null; remainingSeconds: number | null }) =>
    c.remainingSeconds != null
      ? `${c.retryKind ?? "Paused"} — resuming in ${c.remainingSeconds}s…`
      : `${c.retryKind ?? "Paused"} — resuming…`,
}));

// `LLMStreamOutput` is the heavy content renderer the component swaps
// in when `hasContent` is true. Replace it with a sentinel so we can
// distinguish "real content rendered" from "placeholder rendered".
vi.mock("../ChatOutput", () => ({
  LLMStreamOutput: () => <div data-testid="llm-stream-output" />,
}));

// Tighter stub for the per-task copy button so it doesn't pull
// hydration / event-store transitive deps into the test.
vi.mock("./CopyTaskOutputButton", () => ({
  CopyTaskOutputButton: () => null,
}));

vi.mock("./TaskHeaderContextUsage", () => ({
  TaskHeaderContextUsage: () => null,
}));

vi.mock("./TaskOutputPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ActiveTaskStream } from "./ActiveTaskStream";

function makeSyntheticTool(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "synthetic-transition-1",
    name: "transition_task",
    input: {},
    pending: false,
    synthetic: true,
    ...overrides,
  };
}

function makeRealTool(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "real-tool-1",
    name: "read_file",
    input: {},
    pending: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  streamState = {
    isStreaming: true,
    streamingText: "",
    thinkingText: "",
    activeToolCalls: [],
  };
  cooldownState = {
    paused: false,
    retryKind: null,
    remainingSeconds: null,
  };
});

describe("ActiveTaskStream", () => {
  it("renders nothing in the body when only synthetic tool calls are present", () => {
    // The synthetic `transition_task` lifecycle card emitted on
    // `TaskStarted` must not flip `hasContent` to `true` and mount the
    // heavy `LLMStreamOutput`. With the redundant `Waiting for output…`
    // placeholder removed, the body stays empty — the pinned cooking
    // indicator at the bottom of the pane owns the active signal.
    streamState.activeToolCalls = [makeSyntheticTool()];

    render(<ActiveTaskStream taskId="test-task" title="Test task" />);

    expect(screen.queryByText("Waiting for output…")).not.toBeInTheDocument();
    expect(screen.queryByTestId("llm-stream-output")).not.toBeInTheDocument();
  });

  it("renders LLMStreamOutput once a real tool call lands", () => {
    streamState.activeToolCalls = [makeSyntheticTool(), makeRealTool()];

    render(<ActiveTaskStream taskId="test-task" title="Test task" />);

    expect(screen.queryByText("Waiting for output…")).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-stream-output")).toBeInTheDocument();
  });

  it("renders nothing in the body while isStreaming is true but no text/thinking/real-tool content exists", () => {
    // Parent surfaces already gate mounting on
    // `entry.status === "active"`, so once the redundant placeholder
    // is gone there's nothing to render in this window either — the
    // pinned bottom indicator handles the cooking signal.
    streamState.isStreaming = true;
    streamState.streamingText = "";
    streamState.thinkingText = "";
    streamState.activeToolCalls = [];

    render(<ActiveTaskStream taskId="test-task" title="Test task" />);

    expect(screen.queryByText("Waiting for output…")).not.toBeInTheDocument();
    expect(screen.queryByTestId("llm-stream-output")).not.toBeInTheDocument();
  });

  it("renders the cooldown message in the body when the loop is paused for a provider cooldown", () => {
    // Cooldown is the only in-body status line we still surface,
    // because provider-cooldown state isn't shown anywhere else in
    // this pane. Without it, users would have no signal that the
    // loop is intentionally waiting instead of silently stuck.
    cooldownState = {
      paused: true,
      retryKind: "provider_rate_limited",
      remainingSeconds: 30,
    };

    render(<ActiveTaskStream taskId="test-task" title="Test task" />);

    expect(
      screen.getByText(/provider_rate_limited — resuming in 30s…/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("llm-stream-output")).not.toBeInTheDocument();
  });
});
