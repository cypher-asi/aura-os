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

    it("decodes base64 stdout for read_file and never renders the raw envelope", () => {
      const source = "fn main() {}\n";
      const envelope = JSON.stringify({
        tool: "read_file",
        ok: true,
        stdout: btoa(source),
        stderr: "",
        metadata: { size: source.length },
      });
      const { container } = render(
        <ToolCallBlock
          entry={makeEntry({
            name: "read_file",
            pending: false,
            started: false,
            input: { path: "src/main.rs" },
            result: envelope,
          })}
          defaultExpanded
        />,
      );
      expect(container.textContent ?? "").toContain("fn main() {}");
      expect(container.textContent ?? "").not.toContain("\"stdout\"");
      expect(container.textContent ?? "").not.toContain(btoa(source));
    });

    it("shows an inline error when read_file envelope reports ok=false", () => {
      const envelope = JSON.stringify({
        tool: "read_file",
        ok: false,
        stdout: "",
        stderr: btoa("ENOENT: missing.rs\n"),
      });
      const { container } = render(
        <ToolCallBlock
          entry={makeEntry({
            name: "read_file",
            pending: false,
            started: false,
            isError: true,
            input: { path: "missing.rs" },
            result: envelope,
          })}
          defaultExpanded
        />,
      );
      expect(container.textContent ?? "").toContain("ENOENT: missing.rs");
    });
  });

  describe("command block", () => {
    it("decodes base64 stdout/stderr into legible text", () => {
      const envelope = JSON.stringify({
        tool: "run_command",
        ok: true,
        stdout: btoa("Hello, World!\n"),
        stderr: btoa(""),
        exit_code: 0,
      });
      const { container } = render(
        <ToolCallBlock
          entry={makeEntry({
            name: "run_command",
            pending: false,
            started: false,
            input: { command: "cargo run" },
            result: envelope,
          })}
          defaultExpanded
        />,
      );
      expect(container.textContent ?? "").toContain("Hello, World!");
      expect(container.textContent ?? "").toContain("EXIT 0");
      expect(container.textContent ?? "").not.toContain(btoa("Hello, World!\n"));
    });

    it("strips ANSI escapes from decoded cargo-style output", () => {
      const colored = "\x1B[31merror[E0433]\x1B[0m: cannot find crate `foo`\n";
      const envelope = JSON.stringify({
        tool: "run_command",
        ok: false,
        stdout: "",
        stderr: btoa(colored),
        exit_code: 101,
      });
      const { container } = render(
        <ToolCallBlock
          entry={makeEntry({
            name: "run_command",
            pending: false,
            started: false,
            isError: true,
            input: { command: "cargo check --workspace" },
            result: envelope,
          })}
          defaultExpanded
        />,
      );
      const text = container.textContent ?? "";
      expect(text).toContain("error[E0433]: cannot find crate `foo`");
      // eslint-disable-next-line no-control-regex
      expect(text).not.toMatch(/\x1B\[/);
      expect(text).toContain("EXIT 101");
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

    it("renders file paths from a base64 stdout envelope for find_files", () => {
      const listing = "src/main.rs\nsrc/lib.rs\nCargo.toml\n";
      const envelope = JSON.stringify({
        tool: "find_files",
        ok: true,
        stdout: btoa(listing),
        stderr: "",
        metadata: { count: 3 },
      });
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "find_files",
            pending: false,
            started: false,
            input: { pattern: "*" },
            result: envelope,
          })}
          defaultExpanded
        />,
      );
      expect(screen.getByText("src/main.rs")).toBeInTheDocument();
      expect(screen.getByText("src/lib.rs")).toBeInTheDocument();
      expect(screen.getByText("Cargo.toml")).toBeInTheDocument();
      expect(screen.getByText("3 items")).toBeInTheDocument();
    });

    it("renders list rows from a base64 stdout envelope for list_files", () => {
      const listing = "README.md\npackage.json\n";
      const envelope = JSON.stringify({
        tool: "list_files",
        ok: true,
        stdout: btoa(listing),
        stderr: "",
      });
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "list_files",
            pending: false,
            started: false,
            input: { path: "." },
            result: envelope,
          })}
          defaultExpanded
        />,
      );
      expect(screen.getByText("README.md")).toBeInTheDocument();
      expect(screen.getByText("package.json")).toBeInTheDocument();
      expect(screen.getByText("2 items")).toBeInTheDocument();
    });

    it("splits search_code stdout into file:line + match columns", () => {
      const hits = "src/main.rs:12: fn main() {}\nsrc/lib.rs:3: pub fn hello() {}\n";
      const envelope = JSON.stringify({
        tool: "search_code",
        ok: true,
        stdout: btoa(hits),
        stderr: "",
      });
      render(
        <ToolCallBlock
          entry={makeEntry({
            name: "search_code",
            pending: false,
            started: false,
            input: { pattern: "fn" },
            result: envelope,
          })}
          defaultExpanded
        />,
      );
      expect(screen.getByText("src/main.rs:12")).toBeInTheDocument();
      expect(screen.getByText("fn main() {}")).toBeInTheDocument();
      expect(screen.getByText("src/lib.rs:3")).toBeInTheDocument();
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
