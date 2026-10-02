import { describe, expect, it } from "vitest";
import { handleStreamReset } from "./handlers/reset";
import { makeRefs, makeSetters } from "./handlers.test-helpers";

describe("stream connection retry rollback", () => {
  it("preserves prior text, thinking, and completed tools, including Unicode", () => {
    const refs = makeRefs();
    const setters = makeSetters();
    refs.streamBuffer.current = "Earlier.failed 😀";
    refs.thinkingBuffer.current = "Earlier thought.failed 🧠";
    refs.timeline.current = [
      { kind: "text", content: "Earlier.", id: "old" },
      { kind: "tool", toolCallId: "already_done", id: "tool" },
      { kind: "text", content: "failed 😀", id: "failed" },
      { kind: "thinking", text: "Earlier thought.failed 🧠", id: "thought" },
    ];
    const tools = refs.toolCalls.current;
    handleStreamReset(refs, setters, {
      reset_text_bytes: new TextEncoder().encode("failed 😀").length,
      reset_thinking_bytes: new TextEncoder().encode("failed 🧠").length,
    });
    expect(refs.streamBuffer.current).toBe("Earlier.");
    expect(refs.thinkingBuffer.current).toBe("Earlier thought.");
    expect(refs.timeline.current).toHaveLength(3);
    expect(refs.timeline.current[1]).toEqual({ kind: "tool", toolCallId: "already_done", id: "tool" });
    expect(refs.toolCalls.current).toBe(tools);
    expect(setters.calls.setStreamingText.at(-1)).toBe("Earlier.");
  });

  it("leaves text intact for malformed Unicode byte boundaries", () => {
    const refs = makeRefs();
    refs.streamBuffer.current = "Earlier.😀";
    handleStreamReset(refs, makeSetters(), { reset_text_bytes: 1 });
    expect(refs.streamBuffer.current).toBe("Earlier.😀");
  });
});
