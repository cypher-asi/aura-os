import type { ChatAttachment } from "../api/streams";
import type {
  DisplayContentBlockUnion,
  DisplaySessionEvent,
} from "../shared/types/stream";

function decodeBase64Text(base64: string): string {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

export function buildContentBlocks(
  trimmed: string,
  attachments: ChatAttachment[] | undefined,
): DisplayContentBlockUnion[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return [
    ...(trimmed ? [{ type: "text" as const, text: trimmed }] : []),
    ...attachments.map((a) =>
      a.type === "text"
        ? {
            type: "text" as const,
            text: `[File: ${a.name ?? "document"}]\n\n${decodeBase64Text(a.data)}`,
          }
        : { type: "image" as const, media_type: a.media_type, data: a.data },
    ),
  ];
}

export function buildAttachmentLabel(attachments: ChatAttachment[] | undefined): string {
  if (!attachments || attachments.length === 0) return "";
  return attachments.some((a) => a.type === "text")
    ? `[${attachments.length} file(s)]`
    : `[${attachments.length} image(s)]`;
}

/**
 * Build the optimistic user-facing `DisplaySessionEvent` that both
 * chat-stream orchestrators (`useChatStream`, `useAgentChatStream`)
 * append to the stream store at the start of a send. Centralises the
 * `temp-{Date.now()}` id convention and the `trimmed || fallback ||
 * attachment-label` content fallback chain so both call sites stay
 * structurally identical without the inline literal duplication.
 *
 * `fallbackContent` is used when the trimmed text is empty and the
 * caller wants a non-attachment fallback (e.g. the "Generate specs for
 * this project" string used by `useChatStream` when the user clicks
 * the Generate Specs action with no message of their own).
 */
export function buildUserChatMessage(
  trimmed: string,
  attachments: ChatAttachment[] | undefined,
  fallbackContent?: string,
): DisplaySessionEvent {
  return {
    id: `temp-${Date.now()}`,
    role: "user",
    content: trimmed || fallbackContent || buildAttachmentLabel(attachments),
    contentBlocks: buildContentBlocks(trimmed, attachments),
  };
}
