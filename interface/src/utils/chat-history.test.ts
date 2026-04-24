import { extractToolCalls, extractArtifactRefs } from "./chat-history";
import type { ChatContentBlock } from "../types";

describe("extractToolCalls", () => {
  it("returns undefined when no tool_use blocks exist", () => {
    const blocks: ChatContentBlock[] = [
      { type: "text", text: "Hello" },
    ];
    expect(extractToolCalls(blocks)).toBeUndefined();
  });

  it("extracts a single tool call", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "c1", name: "read_file", input: { path: "a.ts" } },
    ];
    const result = extractToolCalls(blocks)!;
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "c1",
      name: "read_file",
      input: { path: "a.ts" },
      result: undefined,
      isError: undefined,
      pending: false,
    });
  });

  it("normalizes stringified JSON tool input", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "c1", name: "submit_plan", input: "{\"approach\":\"fix it\"}" },
    ];
    const result = extractToolCalls(blocks)!;

    expect(result[0].input).toEqual({ approach: "fix it" });
    expect(result[0].input).not.toHaveProperty("0");
  });

  it("preserves malformed string tool input without character keys", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "c1", name: "submit_plan", input: "not json" },
    ];
    const result = extractToolCalls(blocks)!;

    expect(result[0].input).toEqual({ raw_input: "not json" });
    expect(result[0].input).not.toHaveProperty("0");
  });

  it("pairs tool_use with its tool_result", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "c1", name: "read_file", input: {} },
      { type: "tool_result", tool_use_id: "c1", content: "file content", is_error: false },
    ];
    const result = extractToolCalls(blocks)!;
    expect(result[0].result).toBe("file content");
    expect(result[0].isError).toBe(false);
  });

  it("marks error results", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "c1", name: "run_command", input: {} },
      { type: "tool_result", tool_use_id: "c1", content: "failed", is_error: true },
    ];
    const result = extractToolCalls(blocks)!;
    expect(result[0].isError).toBe(true);
  });

  it("handles multiple tool calls with mixed results", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "c1", name: "read_file", input: {} },
      { type: "tool_use", id: "c2", name: "write_file", input: {} },
      { type: "tool_result", tool_use_id: "c1", content: "ok" },
    ];
    const result = extractToolCalls(blocks)!;
    expect(result).toHaveLength(2);
    expect(result[0].result).toBe("ok");
    expect(result[1].result).toBeUndefined();
  });

  it("defaults missing id to empty string", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", name: "test" },
    ];
    const result = extractToolCalls(blocks)!;
    expect(result[0].id).toBe("");
  });

  it("defaults missing name to empty string", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "c1" },
    ];
    const result = extractToolCalls(blocks)!;
    expect(result[0].name).toBe("");
  });

  it("defaults missing input to empty object", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "c1", name: "fn" },
    ];
    const result = extractToolCalls(blocks)!;
    expect(result[0].input).toEqual({});
  });
});

describe("extractArtifactRefs", () => {
  it("returns undefined when no refs exist", () => {
    const blocks: ChatContentBlock[] = [
      { type: "text", text: "Hello" },
    ];
    expect(extractArtifactRefs(blocks)).toBeUndefined();
  });

  it("extracts task refs", () => {
    const blocks: ChatContentBlock[] = [
      { type: "task_ref", task_id: "t1", title: "Task One" },
    ];
    const result = extractArtifactRefs(blocks)!;
    expect(result).toEqual([{ kind: "task", id: "t1", title: "Task One" }]);
  });

  it("extracts spec refs", () => {
    const blocks: ChatContentBlock[] = [
      { type: "spec_ref", spec_id: "s1", title: "Spec One" },
    ];
    const result = extractArtifactRefs(blocks)!;
    expect(result).toEqual([{ kind: "spec", id: "s1", title: "Spec One" }]);
  });

  it("extracts mixed refs in order", () => {
    const blocks: ChatContentBlock[] = [
      { type: "task_ref", task_id: "t1", title: "T" },
      { type: "text", text: "separator" },
      { type: "spec_ref", spec_id: "s1", title: "S" },
    ];
    const result = extractArtifactRefs(blocks)!;
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("task");
    expect(result[1].kind).toBe("spec");
  });

  it("skips task_ref without task_id", () => {
    const blocks: ChatContentBlock[] = [
      { type: "task_ref", title: "No ID" },
    ];
    expect(extractArtifactRefs(blocks)).toBeUndefined();
  });

  it("skips spec_ref without spec_id", () => {
    const blocks: ChatContentBlock[] = [
      { type: "spec_ref", title: "No ID" },
    ];
    expect(extractArtifactRefs(blocks)).toBeUndefined();
  });

  it("defaults missing title to empty string", () => {
    const blocks: ChatContentBlock[] = [
      { type: "task_ref", task_id: "t1" },
    ];
    const result = extractArtifactRefs(blocks)!;
    expect(result[0].title).toBe("");
  });
});
