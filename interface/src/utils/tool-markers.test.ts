import { describe, expect, it } from "vitest";
import {
  expandToolMarkersInTimeline,
  scrubToolMarkup,
  splitTextByToolMarkers,
  trimIncompleteToolMarkerTail,
} from "./tool-markers";
import type { TimelineItem } from "../shared/types/stream";

describe("tool marker parsing", () => {
  it("normalizes read and list aliases", () => {
    const segments = splitTextByToolMarkers(
      "[tool: read(src/db.rs) -> ok]\n[tool: list src -> ok]",
    );

    expect(segments).toEqual([
      expect.objectContaining({ kind: "tool", name: "read_file", arg: "src/db.rs" }),
      expect.objectContaining({ kind: "text", content: "\n" }),
      expect.objectContaining({ kind: "tool", name: "list_files", arg: "src" }),
    ]);
  });

  it("trims incomplete tool marker tails while streaming", () => {
    expect(trimIncompleteToolMarkerTail("Before\n[tool: read")).toBe("Before");
    expect(trimIncompleteToolMarkerTail("[tool: read(src/db.rs) -> ok]")).toBe(
      "[tool: read(src/db.rs) -> ok]",
    );
  });

  it("captures arguments with nested parens (search_code regex bodies)", () => {
    const segments = splitTextByToolMarkers(
      "[tool: search_code(pub fn (ack|mark_attempt|next_due|len|is_empty|contains), context=1) → ok]",
    );

    expect(segments).toEqual([
      expect.objectContaining({
        kind: "tool",
        name: "search_code",
        arg: "pub fn (ack|mark_attempt|next_due|len|is_empty|contains), context=1",
        status: "ok",
      }),
    ]);
  });

  it("does not bleed a nested-paren arg into a sibling marker on the same line", () => {
    const segments = splitTextByToolMarkers(
      "[tool: search_code(pub (struct|fn|enum) , context=2) → ok] then [tool: read(src/db.rs) -> ok]",
    );

    expect(segments).toMatchObject([
      {
        kind: "tool",
        name: "search_code",
        arg: "pub (struct|fn|enum) , context=2",
        status: "ok",
      },
      { kind: "text", content: " then " },
      { kind: "tool", name: "read_file", arg: "src/db.rs", status: "ok" },
    ]);
  });

  it("expands a nested-paren search_code marker into a ToolCallEntry", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          "[tool: search_code(struct SectorEnvelope|impl SectorEnvelope|fn (decode|from_bytes|to_bytes|encode), context=2) → ok]",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "search_code",
      input: {
        query:
          "struct SectorEnvelope|impl SectorEnvelope|fn (decode|from_bytes|to_bytes|encode), context=2",
      },
      isError: false,
      pending: false,
    });
    expect(result.timeline).toMatchObject([
      { kind: "tool", toolCallId: result.toolCalls[0].id },
    ]);
  });

  it("expands textual markers into timeline tool entries", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content: "First\n[tool: read(src/db.rs) -> ok]\nDone",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "read_file",
      input: { path: "src/db.rs" },
      pending: false,
      isError: false,
    });
    expect(result.timeline).toMatchObject([
      { kind: "text", content: "First\n" },
      { kind: "tool", toolCallId: result.toolCalls[0].id },
      { kind: "text", content: "\nDone" },
    ]);
  });
});

describe("pseudo-tool gate markers", () => {
  it("splits an auto-build announcement into a pseudo-tool segment", () => {
    const segments = splitTextByToolMarkers(
      "[auto-build: cargo check --workspace --tests]",
    );

    expect(segments).toEqual([
      expect.objectContaining({
        kind: "pseudo-tool",
        gate: "auto-build",
        body: "cargo check --workspace --tests",
      }),
    ]);
  });

  it("splits a task_done test gate body that contains parens", () => {
    const segments = splitTextByToolMarkers(
      "[task_done test gate: cargo test --workspace --all-features (source: manifest auto-detect)]",
    );

    expect(segments).toEqual([
      expect.objectContaining({
        kind: "pseudo-tool",
        gate: "task_done test gate",
        body: "cargo test --workspace --all-features (source: manifest auto-detect)",
      }),
    ]);
  });

  it("interleaves legacy tool markers and pseudo-tool markers in source order", () => {
    const segments = splitTextByToolMarkers(
      "before [auto-build: cargo build] mid [tool: read(file.rs) -> ok] after",
    );

    expect(segments).toMatchObject([
      { kind: "text", content: "before " },
      { kind: "pseudo-tool", gate: "auto-build", body: "cargo build" },
      { kind: "text", content: " mid " },
      { kind: "tool", name: "read_file", arg: "file.rs" },
      { kind: "text", content: " after" },
    ]);
  });

  it("trims incomplete pseudo-tool marker tails while streaming", () => {
    expect(trimIncompleteToolMarkerTail("preamble [auto-build: cargo che")).toBe(
      "preamble",
    );
    expect(
      trimIncompleteToolMarkerTail("preamble [task_done test gate: cargo te"),
    ).toBe("preamble");
    expect(
      trimIncompleteToolMarkerTail("[auto-build: cargo check --workspace --tests]"),
    ).toBe("[auto-build: cargo check --workspace --tests]");
  });

  it("expands an unpaired auto-build announcement into a synthetic run_command", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content: "Run gate:\n[auto-build: cargo check --workspace --tests]",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "run_command",
      input: { command: "cargo check --workspace --tests" },
      pending: false,
      isError: false,
    });
    expect(result.toolCalls[0].result).toBeUndefined();
  });

  it("pairs a task_done test gate announcement and PASSED result into one entry", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          "[task_done test gate: cargo test --workspace --all-features (source: manifest auto-detect)]\n\n[task_done test gate: PASSED in 3761ms — 173 passed, 0 failed, 3 skipped]",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "run_command",
      input: {
        command:
          "cargo test --workspace --all-features (source: manifest auto-detect)",
      },
      result: "PASSED in 3761ms — 173 passed, 0 failed, 3 skipped",
      isError: false,
      pending: false,
    });

    const toolItems = result.timeline.filter((item) => item.kind === "tool");
    expect(toolItems).toHaveLength(1);
  });

  it("flags a FAILED test gate result with isError", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          "[task_done test gate: cargo test --workspace]\n[task_done test gate: FAILED 2 of 173]",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "run_command",
      input: { command: "cargo test --workspace" },
      result: "FAILED 2 of 173",
      isError: true,
    });
  });

  it("does not pair across mismatched gates", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          "[auto-build: cargo check]\n[task_done test gate: PASSED in 1ms]",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]).toMatchObject({
      input: { command: "cargo check" },
      result: undefined,
    });
    expect(result.toolCalls[1]).toMatchObject({
      input: { command: "task_done test gate" },
      result: "PASSED in 1ms",
    });
  });

  it("emits a standalone result-only marker as a run_command card with the gate as title", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content: "[task_done test gate: PASSED in 3761ms]",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "run_command",
      input: { command: "task_done test gate" },
      result: "PASSED in 3761ms",
      isError: false,
    });
  });

  it("recognizes a post-task_done test run announcement", () => {
    const segments = splitTextByToolMarkers(
      "[post-task_done test run: cargo test --workspace --all-features (source: manifest auto-detect)]",
    );

    expect(segments).toEqual([
      expect.objectContaining({
        kind: "pseudo-tool",
        gate: "post-task_done test run",
        body: "cargo test --workspace --all-features (source: manifest auto-detect)",
      }),
    ]);
  });

  it("pairs a post-task_done test run announcement with its FAILED result", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          "[post-task_done test run: cargo test --workspace --all-features (source: manifest auto-detect)]\n[post-task_done test run: FAILED — 59 passed, 2 failed]",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "run_command",
      input: {
        command:
          "cargo test --workspace --all-features (source: manifest auto-detect)",
      },
      result: "FAILED — 59 passed, 2 failed",
      isError: true,
    });
  });

  it("trims an incomplete post-task_done test run tail while streaming", () => {
    expect(
      trimIncompleteToolMarkerTail("preamble [post-task_done test run: car"),
    ).toBe("preamble");
  });
});

describe("compaction-dialect tool markers", () => {
  it("pairs a tool_use with its following tool_result into one entry", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          '[tool_use list_tasks input={}]\n[tool_result {"ok":true,"tasks":[{"title":"1.0 Refactor"}]}]',
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "list_tasks",
      input: {},
      result: '{"ok":true,"tasks":[{"title":"1.0 Refactor"}]}',
      isError: false,
      pending: false,
    });
    const toolItems = result.timeline.filter((item) => item.kind === "tool");
    expect(toolItems).toHaveLength(1);
  });

  it("parses tool_use input JSON into the entry input", () => {
    const segments = splitTextByToolMarkers(
      '[tool_use read_file input={"path":"src/db.rs"}]',
    );

    expect(segments).toEqual([
      expect.objectContaining({
        kind: "compact-tool-use",
        name: "read_file",
        input: { path: "src/db.rs" },
      }),
    ]);
  });

  it("flags a tool_error result with isError", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content: "[tool_use run_command input={}]\n[tool_error boom failed]",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "run_command",
      result: "boom failed",
      isError: true,
    });
  });

  it("degrades a truncated tool_use input to empty args but keeps the card", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          '[tool_use list_tasks input={"a":"bbbb... [truncated 42 bytes]]\n[tool_result {"tasks":[]}]',
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "list_tasks",
      input: {},
      result: '{"tasks":[]}',
    });
  });

  it("preserves prose surrounding compaction markers", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          "Before\n[tool_use list_specs input={}]\n[tool_result {\"specs\":[]}]\nAfter",
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.timeline).toMatchObject([
      { kind: "text", content: "Before\n" },
      { kind: "tool", toolCallId: result.toolCalls[0].id },
      { kind: "text", content: "\nAfter" },
    ]);
  });

  it("keeps an orphan tool_use (no result) as a result-less card", () => {
    const timeline: TimelineItem[] = [
      { kind: "text", id: "t1", content: "[tool_use list_tasks input={}]" },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "list_tasks",
      pending: false,
    });
    expect(result.toolCalls[0].result).toBeUndefined();
  });

  it("trims an incomplete compaction tool marker tail while streaming", () => {
    expect(trimIncompleteToolMarkerTail("Before\n[tool_use lis")).toBe("Before");
    expect(
      trimIncompleteToolMarkerTail('[tool_result {"tasks":'),
    ).toBe("");
    expect(
      trimIncompleteToolMarkerTail("[tool_use list_tasks input={}]"),
    ).toBe("[tool_use list_tasks input={}]");
  });

  // Regression: a `read_file` dump emitted as an unterminated
  // `[tool_result ...]` marker (multi-line `N|` content, no closing `]`)
  // used to leak verbatim into markdown prose and render as an unreadable
  // mashed wall of text. Once finalized it must hoist into a tool card and
  // leave the model's trailing prose intact.
  const UNCLOSED_DUMP = [
    "[tool_result 150|.megaInner {",
    "151|  max-width: 1180px;",
    "152|  margin: 0 auto;",
    "153|}",
    "154|",
    "209|  transition: background 160ms ease;",
    "210|  </target> </target>",
  ].join("\n") + "\nLet me make it a two-column layout now.";

  it("hoists an unterminated multi-line tool_result into a card once finalized", () => {
    const timeline: TimelineItem[] = [
      { kind: "text", id: "t1", content: UNCLOSED_DUMP },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    const textItems = result.timeline.filter((item) => item.kind === "text");
    // The raw marker / file dump must not survive as renderable prose.
    expect(textItems.some((item) => item.content.includes("tool_result"))).toBe(false);
    expect(textItems.some((item) => item.content.includes("150|.megaInner"))).toBe(false);
    expect(textItems.some((item) => item.content.includes("</target>"))).toBe(false);

    // A real tool entry carries the dump instead.
    const resultEntry = result.toolCalls.find((tc) => tc.name === "tool_result");
    expect(resultEntry).toBeDefined();
    expect(resultEntry?.result).toContain(".megaInner");

    // The model's prose after the dump is preserved as its own segment.
    expect(
      textItems.some((item) => item.content.includes("two-column layout now.")),
    ).toBe(true);
  });

  it("leaves an unterminated tool_result as text while streaming", () => {
    const timeline: TimelineItem[] = [
      { kind: "text", id: "t1", content: UNCLOSED_DUMP },
    ];

    const result = expandToolMarkersInTimeline(timeline, [], { isStreaming: true });

    // Mid-stream the not-yet-closed marker stays put (the stream-safe tail
    // trimmer hides it); we must not flash a half-typed card.
    expect(result.toolCalls.find((tc) => tc.name === "tool_result")).toBeUndefined();
    expect(
      result.timeline.some(
        (item) => item.kind === "text" && item.content.includes("[tool_result"),
      ),
    ).toBe(true);
  });
});

describe("leaked XML / hybrid tool-call markup", () => {
  it("expands a well-formed <invoke> block into a tool entry", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          'I will read it.\n<function_calls>\n<invoke name="read_file">\n<parameter name="path">src/Nav.tsx</parameter>\n</invoke>\n</function_calls>',
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "read_file",
      input: { path: "src/Nav.tsx" },
      isError: false,
      pending: false,
    });
    // No raw markup survives in the text timeline.
    const textContent = result.timeline
      .filter((item) => item.kind === "text")
      .map((item) => (item.kind === "text" ? item.content : ""))
      .join("");
    expect(textContent).not.toMatch(/invoke|function_calls|parameter/);
    expect(textContent).toContain("I will read it.");
  });

  it("renders the reported hybrid marker as a tool block, not raw text", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "text",
        id: "t1",
        content:
          'I\'ll inspect the nav. [tool_use read_file name="Nav.tsx"> </invoke>',
      },
    ];

    const result = expandToolMarkersInTimeline(timeline);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "read_file",
      pending: false,
    });
    const textContent = result.timeline
      .filter((item) => item.kind === "text")
      .map((item) => (item.kind === "text" ? item.content : ""))
      .join("");
    expect(textContent).not.toMatch(/tool_use|invoke/);
    expect(textContent).toContain("I'll inspect the nav.");
  });

  it("scrubs orphan tool tags that have no parseable invoke block", () => {
    expect(scrubToolMarkup("done </invoke>")).toBe("done ");
    expect(scrubToolMarkup("<function_calls>\nthinking")).toBe("\nthinking");
    expect(
      scrubToolMarkup('leftover [tool_use read_file name="Nav.tsx"> tail'),
    ).toBe("leftover  tail");
  });

  it("leaves valid compaction markers untouched when scrubbing", () => {
    const marker = '[tool_use read_file input={"path":"src/db.rs"}]';
    expect(scrubToolMarkup(marker)).toBe(marker);
  });

  it("does not let the hybrid opener swallow a real compaction marker", () => {
    const segments = splitTextByToolMarkers(
      '[tool_use list_tasks input={"name":"x"}]',
    );

    expect(segments).toEqual([
      expect.objectContaining({
        kind: "compact-tool-use",
        name: "list_tasks",
        input: { name: "x" },
      }),
    ]);
  });

  it("hides an in-flight XML invoke block while streaming", () => {
    expect(
      trimIncompleteToolMarkerTail('Before\n<invoke name="read_file">'),
    ).toBe("Before");
    expect(
      trimIncompleteToolMarkerTail("Before\n<function_calls>\n<invoke "),
    ).toBe("Before");
    expect(
      trimIncompleteToolMarkerTail(
        'Before <invoke name="read_file"><parameter name="path">x</parameter></invoke>',
      ),
    ).toBe(
      'Before <invoke name="read_file"><parameter name="path">x</parameter></invoke>',
    );
  });
});
