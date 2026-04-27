import { describe, expect, it } from "vitest";
import {
  expandToolMarkersInTimeline,
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
});
