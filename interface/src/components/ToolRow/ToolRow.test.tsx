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

      expect(screen.getByText("My spec")).toBeInTheDocument();
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

      expect(screen.getByText("Done spec")).toBeInTheDocument();
      expect(screen.getByText("Spec")).toBeInTheDocument();
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

      expect(screen.getByText("New spec")).toBeInTheDocument();
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

      expect(screen.getByText("Spec")).toBeInTheDocument();

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
        expect(screen.queryByText("Spec")).not.toBeInTheDocument();
      });
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
