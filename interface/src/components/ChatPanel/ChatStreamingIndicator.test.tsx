import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatStreamingIndicator } from "./ChatStreamingIndicator";
import type { ToolCallEntry } from "../../types/stream";

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

vi.mock("../../hooks/stream/store", () => ({
  useStreamStore: (selector: (state: unknown) => unknown) =>
    selector({ entries: { "stream-1": mockStreamEntry } }),
}));

vi.mock("./ChatPanel.module.css", () => ({
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

  it("hides the label (but keeps the pinned slot mounted) while text is actively writing", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.streamingText = "hello";
    mockStreamEntry.isWriting = true;

    const { container } = render(<ChatStreamingIndicator streamKey="stream-1" />);

    expect(screen.queryByText("Cooking...")).not.toBeInTheDocument();
    expect(container.querySelector(".pinnedStreamingIndicator")).not.toBeNull();
  });
});
