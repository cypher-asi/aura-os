import { buildTimelineFromBlocks } from "./build-timeline";
import type { ChatContentBlock } from "../types";

describe("buildTimelineFromBlocks", () => {
  it("returns empty array for empty blocks and no thinking", () => {
    expect(buildTimelineFromBlocks([], undefined)).toEqual([]);
  });

  it("prepends a thinking item when thinking text is present", () => {
    const result = buildTimelineFromBlocks([], "I'm thinking...");
    expect(result).toMatchObject([{ kind: "thinking" }]);
  });

  it("does not prepend thinking for empty string", () => {
    const result = buildTimelineFromBlocks([], "");
    expect(result).toEqual([]);
  });

  it("maps text blocks to text timeline items", () => {
    const blocks: ChatContentBlock[] = [
      { type: "text", text: "Hello" },
      { type: "text", text: "World" },
    ];
    const result = buildTimelineFromBlocks(blocks, undefined);
    expect(result).toMatchObject([
      { kind: "text", content: "Hello" },
      { kind: "text", content: "World" },
    ]);
  });

  it("maps tool_use blocks to tool timeline items", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "call-1", name: "read_file" },
    ];
    const result = buildTimelineFromBlocks(blocks, undefined);
    expect(result).toMatchObject([{ kind: "tool", toolCallId: "call-1" }]);
  });

  it("skips tool_result blocks", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_result", tool_use_id: "call-1", content: "result" },
    ];
    const result = buildTimelineFromBlocks(blocks, undefined);
    expect(result).toEqual([]);
  });

  it("skips tool_use without id", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", name: "read_file" },
    ];
    const result = buildTimelineFromBlocks(blocks, undefined);
    expect(result).toEqual([]);
  });

  it("adds fallback text when no text blocks found", () => {
    const blocks: ChatContentBlock[] = [
      { type: "tool_use", id: "call-1", name: "read_file" },
    ];
    const result = buildTimelineFromBlocks(blocks, undefined, "fallback content");
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "text", content: "fallback content" })]),
    );
  });

  it("does not add fallback when text blocks exist", () => {
    const blocks: ChatContentBlock[] = [
      { type: "text", text: "real text" },
    ];
    const result = buildTimelineFromBlocks(blocks, undefined, "fallback");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "text", content: "real text" });
  });

  it("handles text block with undefined text as empty string", () => {
    const blocks: ChatContentBlock[] = [
      { type: "text" },
    ];
    const result = buildTimelineFromBlocks(blocks, undefined);
    expect(result).toMatchObject([{ kind: "text", content: "" }]);
  });

  it("orders thinking before blocks", () => {
    const blocks: ChatContentBlock[] = [
      { type: "text", text: "Hello" },
      { type: "tool_use", id: "t1", name: "fn" },
    ];
    const result = buildTimelineFromBlocks(blocks, "thought");
    expect(result[0]).toMatchObject({ kind: "thinking" });
    expect(result[1]).toMatchObject({ kind: "text", content: "Hello" });
    expect(result[2]).toMatchObject({ kind: "tool", toolCallId: "t1" });
  });

  it("skips image and other block types", () => {
    const blocks: ChatContentBlock[] = [
      { type: "image", media_type: "image/png", data: "abc" },
      { type: "task_ref", task_id: "t1", title: "T" },
      { type: "spec_ref", spec_id: "s1", title: "S" },
    ];
    const result = buildTimelineFromBlocks(blocks, undefined);
    expect(result).toEqual([]);
  });
});
