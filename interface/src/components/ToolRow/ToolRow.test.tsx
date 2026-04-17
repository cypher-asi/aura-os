import { fireEvent, render, screen } from "@testing-library/react";
import type { ToolCallEntry } from "../../types/stream";

vi.mock("./ToolCallBlock.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../Block/Block.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../Block/ThinkingBlock.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../Block/renderers/renderers.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../hooks/use-highlighted-html", () => ({
  useHighlightedHtml: (src: string) => src,
}));

import { ToolCallBlock } from "./ToolRow";

function makeEntry(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "tc-1",
    name: "create_spec",
    input: {},
    pending: false,
    started: false,
    ...overrides,
  };
}

describe("ToolCallBlock (Block dispatch)", () => {
  describe("spec blocks", () => {
    it("renders SpecBlock for pending update_spec with partial markdown", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "update_spec",
            pending: true,
            started: true,
            input: { title: "My spec", markdown_contents: "# Updated heading" },
          })}
        />,
      );
      expect(screen.getByText("my-spec.md")).toBeInTheDocument();
    });

    it("renders SpecBlock with stream caret while pending and empty", () => {
      const { container } = render(
        <ToolCallBlock
          entry={makeEntry({
            name: "create_spec",
            pending: true,
            started: true,
            input: {},
          })}
        />,
      );
      expect(container.querySelector(".codeArea")).not.toBeNull();
      expect(container.querySelector(".streamCaret")).not.toBeNull();
    });

    it("renders SpecBlock with filename once title streams in", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "create_spec",
            pending: true,
            started: true,
            input: { title: "Hello World Website" },
          })}
        />,
      );
      expect(screen.getByText("hello-world-website.md")).toBeInTheDocument();
    });

    it("does not render stream caret once the tool call has completed", () => {
      const { container } = render(
        <ToolCallBlock
          entry={makeEntry({
            name: "create_spec",
            pending: false,
            started: false,
            input: { markdown_contents: "# Done" },
          })}
          defaultExpanded
        />,
      );
      expect(container.querySelector(".streamCaret")).toBeNull();
    });
  });

  describe("file blocks", () => {
    it("renders FileBlock for a pending write_file with partial content", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "write_file",
            pending: true,
            started: true,
            input: { path: "src/hello.ts", content: "export const hello = 1;" },
          })}
        />,
      );
      expect(screen.getByText("hello.ts")).toBeInTheDocument();
      expect(screen.getByText("Write")).toBeInTheDocument();
    });

    it("renders FileBlock for a pending edit_file even before diffs stream in", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "edit_file",
            pending: true,
            started: true,
            input: { path: "src/app.tsx" },
          })}
        />,
      );
      expect(screen.getByText("app.tsx")).toBeInTheDocument();
      expect(screen.getByText("Edit")).toBeInTheDocument();
    });

    it("renders FileBlock for a pending delete_file", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "delete_file",
            pending: true,
            started: true,
            input: { path: "old/stale.txt" },
          })}
        />,
      );
      expect(screen.getByText("stale.txt")).toBeInTheDocument();
      expect(screen.getByText("Delete")).toBeInTheDocument();
    });
  });

  describe("task blocks", () => {
    it("shows the task title once input.title arrives", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "create_task",
            pending: true,
            started: true,
            input: { title: "Set up Dolphin page" },
          })}
          defaultExpanded
        />,
      );
      expect(screen.getAllByText("Set up Dolphin page").length).toBeGreaterThan(0);
    });

    it("renders title and description in the expanded body", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "create_task",
            pending: false,
            started: false,
            input: {
              title: "Add dark mode",
              description: "Wire the theme toggle into settings",
            },
          })}
          defaultExpanded
        />,
      );
      expect(screen.getAllByText("Add dark mode").length).toBeGreaterThan(0);
      expect(screen.getByText("Wire the theme toggle into settings")).toBeInTheDocument();
    });
  });

  describe("list blocks", () => {
    it("renders a list label and summary for list_files", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "list_files",
            pending: true,
            started: true,
            input: { path: "src" },
          })}
          defaultExpanded
        />,
      );
      expect(screen.getByText("List files")).toBeInTheDocument();
      expect(screen.getByText("src")).toBeInTheDocument();
    });

    it("renders list rows from a JSON array result", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "list_specs",
            pending: false,
            started: false,
            input: {},
            result: JSON.stringify({ specs: [{ title: "Spec A" }, { title: "Spec B" }] }),
          })}
          defaultExpanded
        />,
      );
      expect(screen.getByText("Spec A")).toBeInTheDocument();
      expect(screen.getByText("Spec B")).toBeInTheDocument();
    });
  });

  describe("generic fallback block", () => {
    it("renders the generic JSON body for an unknown tool name", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "some_unknown_custom_tool",
            pending: true,
            started: true,
            input: { foo: "bar" },
          })}
          defaultExpanded
        />,
      );
      expect(screen.getByText(/"foo": "bar"/)).toBeInTheDocument();
      expect(screen.getByText("Waiting for the tool result.")).toBeInTheDocument();
    });
  });

  describe("expand toggle", () => {
    it("toggles aria-expanded on user click for a completed tool", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "create_spec",
            pending: false,
            started: false,
            input: { title: "Done spec", markdown_contents: "# Final" },
          })}
          defaultExpanded
        />,
      );

      const header = screen.getByRole("button");
      expect(header).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(header);
      expect(header).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(header);
      expect(header).toHaveAttribute("aria-expanded", "true");
    });
  });
});
