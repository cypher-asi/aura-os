import type { StreamRefs, StreamSetters } from "../../../shared/types/stream";
import { applyThinkingDisplayState, nextTimelineId } from "./shared";

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
    // Resume the existing segment's timer if it was previously closed
    // (e.g. by an aborted tool path) so the duration keeps tracking.
    if (last.startMs == null) last.startMs = Date.now();
  } else {
    // New segment: stamp `startMs` so `closeCurrentThinkingSegment`
    // (called by the text/tool/finalize closers) can compute this
    // segment's own `durationMs` instead of the turn-level total.
    tl.push({ kind: "thinking", id: nextTimelineId(), text, startMs: Date.now() });
  }

  if (refs.thinkingRaf.current === null) {
    let ranSynchronously = false;
    const rafId = requestAnimationFrame(() => {
      ranSynchronously = true;
      refs.thinkingRaf.current = null;
      // Single batched store update (thinkingText + timeline) per frame.
      applyThinkingDisplayState(refs, setters);
    });
    refs.thinkingRaf.current = ranSynchronously ? null : rafId;
  }
}
