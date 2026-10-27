import { describe, expect, it } from "vitest";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import { findConversationMessages } from "./conversation-search";

const message = (id: string, content: string, role: DisplaySessionEvent["role"] = "assistant"): DisplaySessionEvent => ({ id, content, role });

describe("findConversationMessages", () => {
  it("searches loaded user and agent messages literally and case-insensitively", () => {
    const result = findConversationMessages([
      message("u", "Use a.b [v2]", "user"), message("a", "A.B [V2] done"),
      message("s", "a.b [v2] hidden", "system"), message("n", "axb v2"),
    ], " a.b [v2] ");
    expect(result.matches.map((item) => item.id)).toEqual(["u", "a"]);
    expect(result.matches[1].match).toBe("A.B [V2]");
  });

  it("handles Unicode and text blocks without searching image payloads or reasoning", () => {
    const result = findConversationMessages([
      { ...message("blocks", ""), contentBlocks: [{ type: "text", text: "日本語 🦋" }] },
      { ...message("hidden", ""), thinkingText: "日本語", contentBlocks: [{ type: "image", media_type: "image/png", data: "日本語" }] },
    ], "日本語");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ id: "blocks", match: "日本語", after: " 🦋" });
  });

  it("bounds excerpts and results, and treats blank queries as empty", () => {
    expect(findConversationMessages([message("a", "anything")], "  ").matches).toEqual([]);
    const result = findConversationMessages(Array.from({ length: 101 }, (_, i) => message(String(i), `${"x".repeat(200)}needle${"x".repeat(200)}`)), "needle");
    expect(result.matches).toHaveLength(100);
    expect(result.limited).toBe(true);
    expect(result.matches[0].before).toHaveLength(61);
    expect(result.matches[0].after).toHaveLength(101);
  });
});
