import type { DisplaySessionEvent } from "../../../shared/types/stream";

export interface ConversationMatch {
  id: string;
  role: "user" | "assistant";
  before: string;
  match: string;
  after: string;
}

const MAX_RESULTS = 100;

export function findConversationMessages(messages: readonly DisplaySessionEvent[], query: string): {
  matches: ConversationMatch[];
  limited: boolean;
} {
  const term = query.trim();
  const matches: ConversationMatch[] = [];
  if (!term) return { matches, limited: false };
  const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = message.content || message.contentBlocks?.flatMap((block) =>
      block.type === "text" ? [block.text] : []).join("\n") || "";
    const found = pattern.exec(text);
    if (!found) continue;
    if (matches.length === MAX_RESULTS) return { matches, limited: true };
    let start = Math.max(0, found.index - 60);
    let end = Math.min(text.length, found.index + found[0].length + 100);
    if (text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) start -= 1;
    if (text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end += 1;
    matches.push({
      id: message.id,
      role: message.role,
      before: `${start > 0 ? "…" : ""}${text.slice(start, found.index)}`,
      match: found[0],
      after: `${text.slice(found.index + found[0].length, end)}${end < text.length ? "…" : ""}`,
    });
  }
  return { matches, limited: false };
}
