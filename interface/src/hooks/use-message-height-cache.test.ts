import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMessageHeightCache } from "./use-message-height-cache";

describe("useMessageHeightCache", () => {
  it("uses richer estimates for complex assistant output", () => {
    const { result } = renderHook(() => useMessageHeightCache());

    const complexAssistantHeight = result.current.estimateHeight({
      id: "assistant-1",
      role: "assistant",
      content: [
        "# Plan",
        "",
        "Intro paragraph for the response.",
        "",
        "- item one",
        "- item two",
        "",
        "```ts",
        "console.log('hello');",
        "```",
        "",
        "| head | value |",
        "| --- | --- |",
        "| a | b |",
      ].join("\n"),
      toolCalls: [
        { id: "tool-1", name: "create_spec", input: {}, pending: false },
        { id: "tool-2", name: "create_task", input: {}, pending: false },
      ],
      artifactRefs: [
        { id: "spec-1", kind: "spec", title: "Spec" },
        { id: "task-1", kind: "task", title: "Task" },
      ],
      thinkingText: "Reasoning trace ".repeat(20),
      timeline: [
        { id: "tl-1", kind: "thinking" },
        { id: "tl-2", kind: "tool", toolCallId: "tool-1" },
        { id: "tl-3", kind: "tool", toolCallId: "tool-2" },
        { id: "tl-4", kind: "text", content: "Final answer" },
      ],
    });

    expect(complexAssistantHeight).toBeGreaterThan(700);
  });

  it("starts image-heavy user messages with a taller estimate", () => {
    const { result } = renderHook(() => useMessageHeightCache());

    const imageMessageHeight = result.current.estimateHeight({
      id: "user-1",
      role: "user",
      content: "",
      contentBlocks: [
        {
          type: "image",
          media_type: "image/png",
          data: "abc123",
        },
      ],
    });

    expect(imageMessageHeight).toBeGreaterThanOrEqual(320);
  });

  it("stores measured heights once available", () => {
    const { result } = renderHook(() => useMessageHeightCache());

    result.current.setHeight("message-1", 246);

    expect(result.current.getHeight("message-1")).toBe(246);
  });
});
