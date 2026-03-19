import { describe, it, expect } from "vitest";
import { parseTaskStream } from "./parse-task-stream";

describe("parseTaskStream", () => {
  it("returns partial result for non-JSON buffer", () => {
    const result = parseTaskStream("just plain text");
    expect(result.isPartial).toBe(true);
    expect(result.notes).toBeNull();
    expect(result.fileOps).toEqual([]);
  });

  it("returns empty result for agentic tool-use output", () => {
    const buffer = "Analyzing code...\n[tool: read_file -> ok]\nDone.";
    const result = parseTaskStream(buffer);
    expect(result.isPartial).toBe(true);
    expect(result.notes).toBeNull();
  });

  it("parses complete JSON response", () => {
    const buffer = JSON.stringify({
      notes: "Implemented the feature",
      file_ops: [
        { op: "create", path: "src/new.ts" },
        { op: "modify", path: "src/existing.ts" },
      ],
    });
    const result = parseTaskStream(buffer);
    expect(result.isPartial).toBe(false);
    expect(result.notes).toBe("Implemented the feature");
    expect(result.fileOps).toEqual([
      { op: "create", path: "src/new.ts" },
      { op: "modify", path: "src/existing.ts" },
    ]);
  });

  it("handles JSON with missing file_ops gracefully", () => {
    const buffer = JSON.stringify({ notes: "Done" });
    const result = parseTaskStream(buffer);
    expect(result.isPartial).toBe(false);
    expect(result.notes).toBe("Done");
    expect(result.fileOps).toEqual([]);
  });

  it("handles JSON with null notes", () => {
    const buffer = JSON.stringify({ notes: null, file_ops: [] });
    const result = parseTaskStream(buffer);
    expect(result.isPartial).toBe(false);
    expect(result.notes).toBeNull();
  });

  it("incrementally extracts notes from incomplete JSON", () => {
    const buffer = '{"notes": "Partial implementation of the feature';
    const result = parseTaskStream(buffer);
    expect(result.isPartial).toBe(true);
    expect(result.notes).toBe("Partial implementation of the feature");
  });

  it("incrementally extracts file_ops from incomplete JSON", () => {
    const buffer =
      '{"notes": "Done", "file_ops": [{"op": "create", "path": "src/new.ts"}, {"op": "modify", "path": "src/old.ts"}';
    const result = parseTaskStream(buffer);
    expect(result.isPartial).toBe(true);
    expect(result.fileOps).toEqual([
      { op: "create", path: "src/new.ts" },
      { op: "modify", path: "src/old.ts" },
    ]);
  });

  it("handles escaped characters in notes", () => {
    const buffer = JSON.stringify({
      notes: 'Line 1\nLine 2\tTabbed\n"Quoted"',
    });
    const result = parseTaskStream(buffer);
    expect(result.notes).toBe('Line 1\nLine 2\tTabbed\n"Quoted"');
  });

  it("returns empty for empty string", () => {
    const result = parseTaskStream("");
    expect(result.isPartial).toBe(true);
    expect(result.notes).toBeNull();
    expect(result.fileOps).toEqual([]);
  });

  it("handles file_ops with missing fields", () => {
    const buffer = JSON.stringify({
      notes: "ok",
      file_ops: [{ op: "create" }, { path: "foo.ts" }, {}],
    });
    const result = parseTaskStream(buffer);
    expect(result.fileOps).toEqual([
      { op: "create", path: "" },
      { op: "unknown", path: "foo.ts" },
      { op: "unknown", path: "" },
    ]);
  });
});
