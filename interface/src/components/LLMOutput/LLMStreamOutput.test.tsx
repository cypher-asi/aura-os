import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LLMStreamOutput } from "./LLMStreamOutput";
import type { TimelineItem, ToolCallEntry } from "../../types/stream";

vi.mock("../../utils/streaming", () => ({
  getStreamingPhaseLabel: ({ thinkingText, toolCalls, streamingText }: {
    thinkingText?: string;
    toolCalls: ToolCallEntry[];
    streamingText: string;
  }) => {
    if (thinkingText) return "Thinking";
    if (toolCalls.length > 0) return "Calling tools";
    if (streamingText) return "Writing";
    return null;
  },
}));

describe("LLMStreamOutput", () => {
  it("builds synthetic timeline from text when no explicit timeline", () => {
    render(<LLMStreamOutput isStreaming={false} text="Hello" />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("builds synthetic timeline including thinking", () => {
    render(
      <LLMStreamOutput isStreaming={false} text="" thinkingText="Pondering..." />,
    );
    expect(screen.getByText(/Thought/)).toBeInTheDocument();
  });

  it("uses explicit timeline when provided", () => {
    const timeline: TimelineItem[] = [
      { kind: "text", content: "Explicit content", id: "e1" },
    ];
    render(
      <LLMStreamOutput isStreaming={false} text="fallback" timeline={timeline} />,
    );
    expect(screen.getByText("Explicit content")).toBeInTheDocument();
  });

  it("shows streaming indicator when streaming with text", () => {
    render(<LLMStreamOutput isStreaming={true} text="Streaming..." />);
    expect(screen.getByText("Writing")).toBeInTheDocument();
  });

  it("shows thinking phase label when streaming with thinking", () => {
    render(
      <LLMStreamOutput isStreaming={true} text="" thinkingText="..." />,
    );
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("does not show streaming indicator when not streaming", () => {
    render(<LLMStreamOutput isStreaming={false} text="Done" />);
    expect(screen.queryByText("Writing")).not.toBeInTheDocument();
  });
});
