import type { StreamRefs, StreamSetters } from "../../../shared/types/stream";
import { cancelPendingStreamFlush } from "./shared";

/** Rust sends UTF-8 byte lengths, not JavaScript UTF-16 string lengths. */
function withoutUtf8Suffix(text: string, bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return text;
  const encoded = new TextEncoder().encode(text);
  const prefix = encoded.slice(0, Math.max(0, encoded.length - bytes));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(prefix);
  } catch {
    // Ignore malformed lengths rather than corrupting a character.
    return text;
  }
}

/** Remove failed-attempt deltas, retaining earlier iterations and tools. */
export function handleStreamReset(
  refs: StreamRefs,
  setters: StreamSetters,
  reset: { reset_text_bytes?: number; reset_thinking_bytes?: number },
): void {
  const textBytes = reset.reset_text_bytes ?? 0;
  const thinkingBytes = reset.reset_thinking_bytes ?? 0;
  cancelPendingStreamFlush(refs);
  if (refs.thinkingRaf.current !== null) {
    cancelAnimationFrame(refs.thinkingRaf.current);
    refs.thinkingRaf.current = null;
  }
  refs.streamBuffer.current = withoutUtf8Suffix(refs.streamBuffer.current, textBytes);
  refs.thinkingBuffer.current = withoutUtf8Suffix(refs.thinkingBuffer.current, thinkingBytes);
  let remainingText = textBytes;
  let remainingThinking = thinkingBytes;
  const encoder = new TextEncoder();
  for (let i = refs.timeline.current.length - 1; i >= 0; i--) {
    const item = refs.timeline.current[i];
    if (item.kind === "text" && remainingText > 0) {
      const oldBytes = encoder.encode(item.content).length;
      item.content = withoutUtf8Suffix(item.content, Math.min(oldBytes, remainingText));
      remainingText -= oldBytes - encoder.encode(item.content).length;
      if (!item.content) refs.timeline.current.splice(i, 1);
    } else if (item.kind === "thinking" && remainingThinking > 0) {
      const oldBytes = encoder.encode(item.text ?? "").length;
      item.text = withoutUtf8Suffix(item.text ?? "", Math.min(oldBytes, remainingThinking));
      remainingThinking -= oldBytes - encoder.encode(item.text).length;
      if (!item.text) refs.timeline.current.splice(i, 1);
    }
  }
  refs.displayedTextLength.current = refs.streamBuffer.current.length;
  refs.thinkingStart.current = null;
  setters.applyStreamingPatch({
    streamingText: refs.streamBuffer.current,
    thinkingText: refs.thinkingBuffer.current,
    timeline: [...refs.timeline.current],
  });
  setters.setProgressText("Connection interrupted — retrying…");
}
