import type { StreamRefs, StreamSetters } from "../../../shared/types/stream";
import { nextTimelineId, scheduleStreamingTextReveal } from "./shared";

export function handleTextDelta(
  refs: StreamRefs,
  setters: StreamSetters,
  closureThinkingDurationMs: number | null,
  text: string,
): void {
  setters.setProgressText("");
  if (refs.thinkingStart.current !== null && closureThinkingDurationMs === null) {
    setters.setThinkingDurationMs(Date.now() - refs.thinkingStart.current);
  }

  const tl = refs.timeline.current;
  const last = tl.length > 0 ? tl[tl.length - 1] : null;

  refs.streamBuffer.current += text;

  if (last && last.kind === "text") {
    last.content += text;
  } else {
    tl.push({ kind: "text", content: text, id: nextTimelineId() });
  }

  scheduleStreamingTextReveal(refs, setters);
}
