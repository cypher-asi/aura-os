import type { DisplaySessionEvent, ToolCallEntry } from "../../../../shared/types/stream";

/**
 * The minimal "source image" shape the chat 3D mode needs to dispatch
 * an image-to-3D conversion against the AURA 3D backend. Mirrors the
 * fields produced by a successful `generate_image` tool call event
 * (see [ImageBlock.tsx](../../../../components/Block/renderers/ImageBlock.tsx))
 * so the same JSON payload feeds both the gallery render and the 3D
 * source thumb.
 */
export interface LatestGeneratedImage {
  /** Tool-call id; used as a stable React key for thumb re-renders. */
  id: string;
  imageUrl: string;
  originalUrl?: string;
  artifactId?: string;
  prompt?: string;
}

function parseToolResult(result: string | null | undefined): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractImage(entry: ToolCallEntry): LatestGeneratedImage | null {
  if (entry.pending || entry.isError) return null;
  const data = parseToolResult(entry.result);
  if (!data) return null;
  const payload =
    data.payload && typeof data.payload === "object"
      ? (data.payload as Record<string, unknown>)
      : null;
  const imageUrl = (
    data.imageUrl ??
    data.url ??
    data.image_url ??
    data.assetUrl ??
    data.asset_url ??
    payload?.imageUrl ??
    payload?.url ??
    payload?.image_url ??
    payload?.assetUrl ??
    payload?.asset_url
  ) as string | undefined;
  if (!imageUrl || typeof imageUrl !== "string") return null;
  const originalUrl = (
    data.originalUrl ??
    data.original_url ??
    payload?.originalUrl ??
    payload?.original_url
  ) as string | undefined;
  const artifactId = (data.artifactId ?? payload?.artifactId) as string | undefined;
  const prompt =
    (data.prompt as string | undefined) ??
    ((data as { meta?: { prompt?: string } } | null)?.meta?.prompt) ??
    (entry.input?.prompt as string | undefined);
  return {
    id: entry.id,
    imageUrl,
    originalUrl: typeof originalUrl === "string" ? originalUrl : undefined,
    artifactId: typeof artifactId === "string" ? artifactId : undefined,
    prompt: typeof prompt === "string" ? prompt : undefined,
  };
}

/**
 * Walk a chat event list newest -> oldest looking for the most recent
 * successful `generate_image` tool result and return its public URL.
 * Returns `null` when the thread contains no usable image.
 *
 * Used by chat 3D mode: the 3D pill in the input bar is gated on a
 * non-null result here so the user must follow the same "image first"
 * path the standalone AURA 3D app enforces. Manual file attachments
 * are intentionally NOT considered — that proxy path is currently
 * disabled (see `useChatStream` / `useAgentChatStream`).
 */
export function findLatestGeneratedImage(
  messages: readonly DisplaySessionEvent[] | undefined,
): LatestGeneratedImage | null {
  if (!messages || messages.length === 0) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const event = messages[i];
    const tools = event.toolCalls;
    if (!tools || tools.length === 0) continue;
    for (let j = tools.length - 1; j >= 0; j -= 1) {
      const tool = tools[j];
      if (tool.name !== "generate_image") continue;
      const image = extractImage(tool);
      if (image) return image;
    }
  }
  return null;
}
