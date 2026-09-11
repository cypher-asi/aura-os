import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStreamingIndicator } from "./ChatStreamingIndicator";
import type { ToolCallEntry } from "../../../shared/types/stream";
import type { StreamHealth } from "../../../hooks/stream/use-stream-health";
import type { GenerationEta } from "../../../hooks/stream/use-generation-eta";

const mockStreamEntry: {
  isStreaming: boolean;
  isWriting: boolean;
  streamingText: string;
  thinkingText: string;
  activeToolCalls: ToolCallEntry[];
  progressText: string;
} = {
  isStreaming: false,
  isWriting: false,
  streamingText: "",
  thinkingText: "",
  activeToolCalls: [],
  progressText: "",
};

const mockStreamHealth: StreamHealth = {
  isStreaming: false,
  lastEventAt: null,
  lastEventAgeMs: null,
  isStuck: false,
  stuckForMs: null,
};

let mockGenerationEta: GenerationEta | null = null;

vi.mock("../../../hooks/stream/store", () => ({
  useStreamStore: (selector: (state: unknown) => unknown) =>
    selector({ entries: { "stream-1": mockStreamEntry } }),
}));

vi.mock("../../../hooks/stream/use-stream-health", () => ({
  useStreamHealth: () => mockStreamHealth,
}));

vi.mock("../../../hooks/stream/use-generation-eta", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../hooks/stream/use-generation-eta")
  >();
  return {
    ...actual,
    useGenerationEta: () => mockGenerationEta,
  };
});

vi.mock("./ChatPanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../components/StuckStreamPill/StuckStreamPill.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("ChatStreamingIndicator", () => {
  beforeEach(() => {
    Object.assign(mockStreamEntry, {
      isStreaming: false,
      isWriting: false,
      streamingText: "",
      thinkingText: "",
      activeToolCalls: [],
      progressText: "",
    });
    Object.assign(mockStreamHealth, {
      isStreaming: false,
      lastEventAt: null,
      lastEventAgeMs: null,
      isStuck: false,
      stuckForMs: null,
    });
    mockGenerationEta = null;
  });

  it("renders nothing when the stream is idle", () => {
    const { container } = render(<ChatStreamingIndicator streamKey="stream-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the cooking phase label when streaming without active writing", () => {
    mockStreamEntry.isStreaming = true;

    render(<ChatStreamingIndicator streamKey="stream-1" />);

    expect(screen.getByText("Cooking...")).toBeInTheDocument();
  });

  it("shows Thinking... when a reasoning buffer is live", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.thinkingText = "pondering";

    render(<ChatStreamingIndicator streamKey="stream-1" />);

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("keeps the cooking shimmer visible while text is actively writing (no flicker between word reveals)", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.streamingText = "hello";
    mockStreamEntry.isWriting = true;

    const { container } = render(<ChatStreamingIndicator streamKey="stream-1" />);

    expect(screen.getByText("Cooking...")).toBeInTheDocument();
    expect(container.querySelector(".pinnedStreamingIndicator")).not.toBeNull();
  });

  it("renders the Queued... shimmer when the partition is waiting behind another turn", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.progressText = "queued";

    render(<ChatStreamingIndicator streamKey="stream-1" />);

    expect(screen.getByText("Queued...")).toBeInTheDocument();
  });

  it("swaps to the StuckStreamPill when the watchdog reports isStuck", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamHealth.isStreaming = true;
    mockStreamHealth.lastEventAt = Date.now() - 45_000;
    mockStreamHealth.lastEventAgeMs = 45_000;
    mockStreamHealth.isStuck = true;
    mockStreamHealth.stuckForMs = 15_000;

    render(
      <ChatStreamingIndicator
        streamKey="stream-1"
        onStop={() => {}}
        onRetry={() => {}}
        onReport={() => {}}
      />,
    );

    expect(
      screen.getByText("Agent paused for 15s — last activity was 45s ago"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cooking...")).not.toBeInTheDocument();
  });

  it("forwards Stop / Retry clicks from the pill to the wired callbacks (Phase 5: Report is an inline ReportBugButton)", async () => {
    mockStreamEntry.isStreaming = true;
    mockStreamHealth.isStreaming = true;
    mockStreamHealth.lastEventAt = Date.now() - 32_000;
    mockStreamHealth.lastEventAgeMs = 32_000;
    mockStreamHealth.isStuck = true;
    mockStreamHealth.stuckForMs = 2_000;

    const onStop = vi.fn();
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(
      <ChatStreamingIndicator
        streamKey="stream-1"
        onStop={onStop}
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(screen.getByRole("button", { name: "Restart turn" }));
    // Phase 5: the legacy generic "Report" button has been replaced
    // by an inline `ReportBugButton` ("Report bug") that opens
    // `NewFeedbackModal` itself; ChatStreamingIndicator no longer
    // owns the click handler. We assert the affordance is still
    // present here and let `ReportBugButton.test.tsx` cover the
    // modal-pre-fill behaviour end-to-end.
    expect(
      screen.getByRole("button", { name: "Report bug" }),
    ).toBeInTheDocument();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders an estimated countdown next to the cooking label while an image is generating", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.progressText = "Generating image...";
    mockGenerationEta = { remainingMs: 42_000, overrun: false, kind: "image" };

    render(<ChatStreamingIndicator streamKey="stream-1" />);

    expect(screen.getByText("Generating image...")).toBeInTheDocument();
    expect(screen.getByLabelText("Estimated time remaining")).toHaveTextContent(
      "0:42",
    );
  });

  it("swaps to 'Almost done…' and drops the digits once the estimate has overrun", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.progressText = "Generating image...";
    mockGenerationEta = { remainingMs: 0, overrun: true, kind: "image" };

    render(<ChatStreamingIndicator streamKey="stream-1" />);

    expect(screen.getByText("Almost done\u2026")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Estimated time remaining"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Generating image...")).not.toBeInTheDocument();
  });

  it("does not render a countdown when no generation is in flight", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.streamingText = "hello";

    render(<ChatStreamingIndicator streamKey="stream-1" />);

    expect(screen.getByText("Cooking...")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Estimated time remaining"),
    ).not.toBeInTheDocument();
  });
});
