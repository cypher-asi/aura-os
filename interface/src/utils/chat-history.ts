import type { ChatContentBlock } from "../shared/types";
import type { ToolCallEntry, ArtifactRef } from "../shared/types/stream";
import { normalizeToolInput } from "./tool-input";

export function extractToolCalls(blocks: ChatContentBlock[]): ToolCallEntry[] | undefined {
  const toolUseBlocks = blocks.filter(
    (b): b is Extract<ChatContentBlock, { type: "tool_use" }> => b.type === "tool_use",
  );
  if (toolUseBlocks.length === 0) return undefined;

  const resultMap = new Map<string, { result: string; isError: boolean }>();
  for (const b of blocks) {
    if (b.type === "tool_result") {
      resultMap.set(b.tool_use_id, {
        result: b.content ?? "",
        isError: b.is_error === true,
      });
    }
  }

  return toolUseBlocks.map((b) => {
    const res = resultMap.get(b.id);
    return {
      id: b.id ?? "",
      name: b.name ?? "",
      input: normalizeToolInput(b.input),
      result: res?.result,
      isError: res?.isError,
      pending: false,
    };
  });
}

export function extractArtifactRefs(blocks: ChatContentBlock[]): ArtifactRef[] | undefined {
  const refs: ArtifactRef[] = [];
  for (const b of blocks) {
    if (b.type === "task_ref") {
      if (b.task_id) refs.push({ kind: "task", id: b.task_id, title: b.title ?? "" });
    } else if (b.type === "spec_ref") {
      if (b.spec_id) refs.push({ kind: "spec", id: b.spec_id, title: b.title ?? "" });
    }
  }
  return refs.length > 0 ? refs : undefined;
}
