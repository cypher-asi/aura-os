import type { StreamRefs, StreamSetters } from "../../../shared/types/stream";
import { nextTimelineId, syncDisplayedTimeline } from "./shared";

export function handleThinkingDelta(
  refs: StreamRefs,
  setters: StreamSetters,
  text: string,
): void {
  setters.setProgressText("");
  if (refs.thinkingStart.current === null) {
    refs.thinkingStart.current = Date.now();
  }
  refs.thinkingBuffer.current += text;

  const tl = refs.timeline.current;
  const lastIdx = tl.length - 1;
  const last = lastIdx >= 0 ? tl[lastIdx] : null;
  if (last && last.kind === "thinking") {
    last.text = (last.text ?? "") + text;
  } else {
    tl.push({ kind: "thinking", id: nextTimelineId(), text });
  }

  if (refs.thinkingRaf.current === null) {
    let ranSynchronously = false;
    const rafId = requestAnimationFrame(() => {
      ranSynchronously = true;
      refs.thinkingRaf.current = null;
      setters.setThinkingText(refs.thinkingBuffer.current);
      syncDisplayedTimeline(refs, setters);
    });
    refs.thinkingRaf.current = ranSynchronously ? null : rafId;
  }
}
