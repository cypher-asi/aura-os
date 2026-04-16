import { render, screen, waitFor } from "@testing-library/react";
import type { ToolCallEntry } from "../../types/stream";

vi.mock("./ToolCallBlock.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../FilePreviewCard/FilePreviewCard.module.css", () => ({
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

describe("ToolCallBlock", () => {
  describe("update_spec streaming preview", () => {
    it("renders SpecPreviewCard when update_spec is started with partial markdown_contents", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "update_spec",
            started: true,
            pending: true,
            input: {
              title: "My spec",
              markdown_contents: "# Updated heading\nSome content",
            },
          })}
        />,
      );

      expect(screen.getByText("my-spec.md")).toBeInTheDocument();
      expect(screen.queryByText("Generating…")).not.toBeInTheDocument();
    });

    it("renders Generating… when update_spec is started with no markdown_contents yet", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "update_spec",
            started: true,
            pending: true,
            input: {},
          })}
        />,
      );

      expect(screen.getByText("Generating…")).toBeInTheDocument();
    });

    it("renders an empty SpecPreviewCard with filename once the title streams in", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "update_spec",
            started: true,
            pending: true,
            input: { title: "Hello World Website" },
          })}
        />,
      );

      expect(screen.getByText("hello-world-website.md")).toBeInTheDocument();
    });

    it("renders SpecPreviewCard when update_spec is completed", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "update_spec",
            started: false,
            pending: false,
            input: {
              title: "Done spec",
              markdown_contents: "# Final content",
            },
          })}
          defaultExpanded
        />,
      );

      expect(screen.getByText("done-spec.md")).toBeInTheDocument();
    });
  });

  describe("create_spec still works", () => {
    it("renders SpecPreviewCard when create_spec is started with partial markdown_contents", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "create_spec",
            started: true,
            pending: true,
            input: {
              title: "New spec",
              markdown_contents: "# Draft",
            },
          })}
        />,
      );

      expect(screen.getByText("new-spec.md")).toBeInTheDocument();
      expect(screen.queryByText("Generating…")).not.toBeInTheDocument();
    });

    it("collapses the detail view when a running action completes", async () => {
      const entry = makeEntry({
        name: "create_spec",
        started: true,
        pending: true,
        input: {
          title: "In progress spec",
          markdown_contents: "# Draft",
        },
      });
      const { rerender } = render(
        <ToolCallBlock
          entry={entry}
          defaultExpanded={entry.pending}
        />,
      );

      expect(screen.getByText("in-progress-spec.md")).toBeInTheDocument();

      const completedEntry = {
        ...entry,
        started: false,
        pending: false,
      };

      rerender(
        <ToolCallBlock
          entry={completedEntry}
          defaultExpanded={completedEntry.pending}
        />,
      );

      await waitFor(() => {
        expect(screen.queryByText("in-progress-spec.md")).not.toBeInTheDocument();
      });
    });
  });

  describe("file-op streaming preview", () => {
    it("renders FilePreviewCard for a pending write_file with partial content", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "write_file",
            started: true,
            pending: true,
            input: {
              path: "src/hello.ts",
              content: "export const hello = 1;",
            },
          })}
        />,
      );

      expect(screen.getByText("hello.ts")).toBeInTheDocument();
      expect(screen.getByText("Write")).toBeInTheDocument();
      expect(screen.queryByText("Generating…")).not.toBeInTheDocument();
      expect(screen.queryByText("Waiting for the tool result.")).not.toBeInTheDocument();
    });

    it("renders FilePreviewCard for a pending edit_file even before old_text/new_text stream in", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "edit_file",
            started: true,
            pending: true,
            input: { path: "src/app.tsx" },
          })}
        />,
      );

      expect(screen.getByText("app.tsx")).toBeInTheDocument();
      expect(screen.getByText("Edit")).toBeInTheDocument();
      expect(screen.queryByText("Waiting for the tool result.")).not.toBeInTheDocument();
    });

    it("renders FilePreviewCard for a pending delete_file", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "delete_file",
            started: true,
            pending: true,
            input: { path: "old/stale.txt" },
          })}
        />,
      );

      expect(screen.getByText("stale.txt")).toBeInTheDocument();
      expect(screen.getByText("Delete")).toBeInTheDocument();
    });

    it("still shows Generating… for a file op that has no path yet", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "write_file",
            started: true,
            pending: true,
            input: {},
          })}
        />,
      );

      expect(screen.getByText("Generating…")).toBeInTheDocument();
    });
  });

  describe("non-spec tools unchanged", () => {
    it("shows Generating… for a non-spec tool in started state", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "create_task",
            started: true,
            pending: true,
            input: { title: "Some task" },
          })}
        />,
      );

      expect(screen.getByText("Generating…")).toBeInTheDocument();
    });

    it("shows pending input details when a non-spec action is expanded", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "list_files",
            pending: true,
            started: true,
            input: { target_directory: "src" },
          })}
          defaultExpanded
        />,
      );

      expect(screen.getByText(/"target_directory": "src"/)).toBeInTheDocument();
      expect(screen.getByText("Waiting for the tool result.")).toBeInTheDocument();
    });

    it("shows structured input context for empty input payloads", () => {
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "list_files",
            pending: false,
            started: false,
            input: {},
          })}
          defaultExpanded
        />,
      );

      expect(screen.getByText(/"explicitInput": \{\}/)).toBeInTheDocument();
      expect(screen.getByText(/"resolvedContext": \{/)).toBeInTheDocument();
      expect(screen.getByText(/"resolution": "implicit_defaults_possible"/)).toBeInTheDocument();
    });
  });
});
