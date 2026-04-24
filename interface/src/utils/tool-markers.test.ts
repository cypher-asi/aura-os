import { describe, expect, it } from "vitest";
import {
  expandToolMarkersInTimeline,
  splitTextByToolMarkers,
  trimIncompleteToolMarkerTail,
} from "./tool-markers";
import type { TimelineItem } from "../types/stream";

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
