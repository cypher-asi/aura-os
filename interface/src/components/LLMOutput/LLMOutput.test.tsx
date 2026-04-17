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

  it("renders thinking content expanded initially when defaultThinkingExpanded is true", () => {
    render(
      <LLMOutput
        content=""
        thinkingText="Considering options..."
        defaultThinkingExpanded
      />,
    );
    expect(screen.getByText("Considering options...")).toBeInTheDocument();
  });

  it("renders tool calls via ToolCallsList when no timeline", () => {
    const toolCalls: ToolCallEntry[] = [
      { id: "t1", name: "read_file", input: { path: "foo.ts" }, pending: false },
    ];
    render(<LLMOutput content="" toolCalls={toolCalls} />);
    expect(screen.getByText("foo.ts")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
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

  it("keeps finalized list/delete/get tools collapsed in a just-finalized bubble", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "t1",
        name: "list_specs",
        input: { project_id: "p1" },
        pending: false,
        result: '{"ok":true,"specs":[{"title":"01: Hello World"}]}',
      },
      {
        id: "t2",
        name: "delete_spec",
        input: { spec_id: "abc" },
        pending: false,
        result: '{"ok":true}',
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "t1", id: "tl1" },
      { kind: "tool", toolCallId: "t2", id: "tl2" },
    ];
    render(
      <LLMOutput
        content=""
        timeline={timeline}
        toolCalls={toolCalls}
        defaultActivitiesExpanded
      />,
    );

    const headers = screen.getAllByRole("button");
    for (const header of headers) {
      expect(header).toHaveAttribute("aria-expanded", "false");
    }
  });

  it("auto-expands create_spec and write_file so live preview stays visible after finalize", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "s1",
        name: "create_spec",
        input: { title: "Hello", markdown_contents: "# Hi" },
        pending: false,
      },
      {
        id: "w1",
        name: "write_file",
        input: { path: "src/a.ts", content: "export {}" },
        pending: false,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "s1", id: "tl1" },
      { kind: "tool", toolCallId: "w1", id: "tl2" },
    ];
    render(
      <LLMOutput
        content=""
        timeline={timeline}
        toolCalls={toolCalls}
        defaultActivitiesExpanded
      />,
    );

    const headers = screen.getAllByRole("button");
    for (const header of headers) {
      expect(header).toHaveAttribute("aria-expanded", "true");
    }
  });
});
