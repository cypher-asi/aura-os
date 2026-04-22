import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplaySessionEvent, ToolCallEntry, TimelineItem } from "../../types/stream";
import { TaskOutputSection } from "./TaskOutputSection";

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

vi.mock("../MessageBubble", () => ({
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
}));

vi.mock("../StreamingBubble", () => ({
  StreamingBubble: () => <div data-testid="streaming-bubble" />,
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
});
