import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LLMStreamOutput } from "./LLMStreamOutput";
import type { TimelineItem, ToolCallEntry } from "../../../../shared/types/stream";

vi.mock("../../../../utils/streaming", () => ({
  getStreamingPhaseLabel: ({ thinkingText, toolCalls, streamingText, isWriting }: {
    thinkingText?: string;
    toolCalls: ToolCallEntry[];
    streamingText: string;
    isWriting?: boolean;
  }) => {
    if (isWriting) return null;
    if (thinkingText) return "Thinking";
    if (toolCalls.length > 0) return "Calling tools";
    if (streamingText) return "Cooking";
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

  it("shows cooking indicator when streaming with settled text", () => {
    render(<LLMStreamOutput isStreaming={true} text="Streaming..." />);
    expect(screen.getByText("Cooking")).toBeInTheDocument();
  });

  it("hides indicator while text is actively writing", () => {
    render(
      <LLMStreamOutput
        isStreaming={true}
        text="Streaming..."
        isWriting={true}
      />,
    );
    expect(screen.queryByText("Cooking")).not.toBeInTheDocument();
  });

  it("shows thinking phase label when streaming with thinking", () => {
    render(
      <LLMStreamOutput isStreaming={true} text="" thinkingText="..." />,
    );
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("does not show streaming indicator when not streaming", () => {
    render(<LLMStreamOutput isStreaming={false} text="Done" />);
    expect(screen.queryByText("Cooking")).not.toBeInTheDocument();
  });

  it("suppresses inline phase indicator when showPhaseIndicator is false", () => {
    render(
      <LLMStreamOutput
        isStreaming={true}
        text="Streaming..."
        showPhaseIndicator={false}
      />,
    );
    expect(screen.queryByText("Cooking")).not.toBeInTheDocument();
  });

  it("renders textual read/list tool markers through the shared block registry", () => {
    render(
      <LLMStreamOutput
        isStreaming={false}
        text={"[tool: read(src/db.rs) -> ok]\n[tool: list(src) -> ok]"}
      />,
    );

    expect(screen.getByText("db.rs")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("List files")).toBeInTheDocument();
    expect(screen.queryByText(/\[tool:/)).not.toBeInTheDocument();
  });
});
