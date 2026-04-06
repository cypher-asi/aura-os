import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LLMOutput } from "./LLMOutput";
import type { TimelineItem, ToolCallEntry } from "../../types/stream";

describe("LLMOutput", () => {
  it("returns null when no content, tools, thinking, or timeline", () => {
    const { container } = render(<LLMOutput content="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders text content via SegmentedContent when no timeline", () => {
    render(<LLMOutput content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders thinking row when thinkingText provided", () => {
    render(<LLMOutput content="" thinkingText="Considering options..." />);
    expect(screen.getByText(/Thought/)).toBeInTheDocument();
  });

  it("renders tool calls via ToolCallsList when no timeline", () => {
    const toolCalls: ToolCallEntry[] = [
      { id: "t1", name: "read_file", input: { path: "foo.ts" }, pending: false },
    ];
    render(<LLMOutput content="" toolCalls={toolCalls} />);
    expect(screen.getByText(/Read file/i)).toBeInTheDocument();
  });

  it("renders ActivityTimeline when timeline is provided", () => {
    const timeline: TimelineItem[] = [
      { kind: "text", content: "Timeline text", id: "t1" },
    ];
    render(<LLMOutput content="fallback" timeline={timeline} />);
    expect(screen.getByText("Timeline text")).toBeInTheDocument();
  });

  it("renders artifact refs", () => {
    const artifactRefs = [
      { kind: "spec" as const, id: "s1", title: "Auth spec" },
      { kind: "task" as const, id: "t1", title: "Implement login" },
    ];
    render(<LLMOutput content="text" artifactRefs={artifactRefs} />);
    expect(screen.getByText("Auth spec")).toBeInTheDocument();
    expect(screen.getByText("Implement login")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<LLMOutput content="test" className="custom" />);
    expect(container.firstChild).toHaveClass("custom");
  });
});
