import type {
  TimelineItem,
  ToolCallEntry,
  StreamRefs,
  StreamSetters,
} from "../../../shared/types/stream";

export interface PendingToolResolution {
  isError: boolean;
  result?: string;
}

const SPEC_WRITE_TOOL_NAMES = new Set(["create_spec", "update_spec"]);

/* ------------------------------------------------------------------ */
/*  Frame-driven reveal pacing.                                        */
/*                                                                     */
/*  The reveal runs as a single requestAnimationFrame loop: at most    */
/*  ONE store update per display frame, no matter how fast tokens      */
/*  arrive on the wire. Each frame reveals a time-based character      */
/*  budget (words are never split mid-word) whose rate scales with     */
/*  the hidden backlog, so the animation stays smooth at a calm pace   */
/*  when caught up but can never fall behind unboundedly. A backlog    */
/*  past REVEAL_FULL_FLUSH_CHARS skips the animation entirely — at     */
/*  that size the user is watching a wall of text anyway and the      */
/*  per-frame markdown re-render is pure waste.                        */
/*                                                                     */
/*  This replaced a setTimeout(8-42ms)-per-word chain that fired up   */
/*  to ~125 store updates/sec (each one a full React commit + forced   */
/*  layout), starving everything else on the main thread — most        */
/*  visibly the xterm.js terminal.                                     */
/* ------------------------------------------------------------------ */

/** Floor reveal rate (chars/sec) when the backlog is small. */
const REVEAL_MIN_CPS = 180;
/** Target wall-clock to drain whatever backlog exists right now. */
const REVEAL_BACKLOG_DRAIN_MS = 350;
/** Backlog size beyond which the animation is skipped entirely. */
const REVEAL_FULL_FLUSH_CHARS = 6000;
/** Clamp per-frame elapsed time so a long stall (tab hidden, GC
 *  pause) doesn't dump a huge burst in a single frame. */
const REVEAL_MAX_FRAME_MS = 64;
const REVEAL_MIN_FRAME_MS = 8;
const MARKDOWN_LINE_PREFIX_RE = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s+|#{1,6}\s+)/;
const CODE_FENCE_LINE_RE = /^(?:`{3,}|~{3,})[^\n]*(?:\n|$)/;

export function snapshotThinking(refs: StreamRefs) {
  return {
    savedThinking: refs.thinkingBuffer.current || undefined,
    savedThinkingDuration: refs.thinkingStart.current != null
      ? Date.now() - refs.thinkingStart.current
      : null,
  };
}

export function snapshotToolCalls(refs: StreamRefs): ToolCallEntry[] | undefined {
  return refs.toolCalls.current.length > 0
    ? [...refs.toolCalls.current]
    : undefined;
}

export function snapshotTimeline(refs: StreamRefs): TimelineItem[] | undefined {
  return refs.timeline.current.length > 0
    ? [...refs.timeline.current]
    : undefined;
}

export function cancelPendingStreamFlush(refs: StreamRefs): void {
  if (refs.flushTimeout.current !== null) {
    clearTimeout(refs.flushTimeout.current);
    refs.flushTimeout.current = null;
  }
  if (refs.raf.current !== null) {
    cancelAnimationFrame(refs.raf.current);
    refs.raf.current = null;
  }
}

function getDisplayedStreamingText(refs: StreamRefs): string {
  return refs.streamBuffer.current.slice(0, refs.displayedTextLength.current);
}

function buildDisplayedTimeline(
  refs: StreamRefs,
  visibleText: string,
): TimelineItem[] {
  // Strict, in-order reveal. The timeline is rendered in real stream
  // order, but nothing below a still-typing paragraph is allowed to
  // appear before that paragraph has finished its word-by-word reveal.
  // We walk the timeline against the global reveal cursor and stop the
  // moment we reach a `text` segment that is not yet fully revealed —
  // every later row (tool, thinking, or another paragraph) stays hidden
  // until the cursor catches up.
  //
  // This is a *positional* gate, which is what makes it correct where
  // the prior global `textPending` flag was not. `textPending` asked
  // "is any text anywhere unrevealed?" and hid all non-text rows, so a
  // `text_delta` extending the trailing paragraph would blink out tool
  // rows that sat *above* it and were already correctly revealed. By
  // stopping at the first unrevealed text segment instead, rows above a
  // fully-revealed paragraph stay stable (no blink-out) while rows below
  // a still-typing one are held back (no jumping ahead of the text).
  const displayedTimeline: TimelineItem[] = [];
  let remainingVisibleText = visibleText;

  for (const item of refs.timeline.current) {
    if (item.kind === "text") {
      const fullyRevealed = remainingVisibleText.length >= item.content.length;
      const visibleSegment = remainingVisibleText.slice(
        0,
        Math.min(item.content.length, remainingVisibleText.length),
      );
      remainingVisibleText = remainingVisibleText.slice(visibleSegment.length);
      if (visibleSegment.length > 0) {
        displayedTimeline.push({ ...item, content: visibleSegment });
      }
      if (!fullyRevealed) break;
      continue;
    }

    displayedTimeline.push({ ...item });
  }

  return displayedTimeline;
}

export function syncDisplayedTimeline(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  setters.applyStreamingPatch({
    timeline: buildDisplayedTimeline(refs, getDisplayedStreamingText(refs)),
  });
}

/**
 * Thinking-coalescer publish: thinking text + the gated timeline in one
 * store update. Called from `handleThinkingDelta`'s per-frame rAF.
 */
export function applyThinkingDisplayState(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  setters.applyStreamingPatch({
    thinkingText: refs.thinkingBuffer.current,
    timeline: buildDisplayedTimeline(refs, getDisplayedStreamingText(refs)),
  });
}

function applyDisplayedStreamingState(
  refs: StreamRefs,
  setters: StreamSetters,
  displayedTextLength: number,
): void {
  refs.displayedTextLength.current = displayedTextLength;
  refs.lastTextFlushAt.current = Date.now();

  const visibleText = getDisplayedStreamingText(refs);
  setters.applyStreamingPatch({
    streamingText: visibleText,
    timeline: buildDisplayedTimeline(refs, visibleText),
    isWriting: refs.displayedTextLength.current < refs.streamBuffer.current.length,
  });
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function getNextWordRevealIndex(buffer: string, start: number): number {
  if (start >= buffer.length) return buffer.length;

  let cursor = start;
  while (cursor < buffer.length && isWhitespace(buffer[cursor])) {
    cursor++;
  }
  if (cursor >= buffer.length) {
    return buffer.length;
  }

  const consumedLeadingWhitespace = buffer.slice(start, cursor);
  const isLineStart = start === 0
    || buffer[start - 1] === "\n"
    || consumedLeadingWhitespace.includes("\n");
  const remaining = buffer.slice(cursor);

  if (isLineStart) {
    const codeFenceMatch = remaining.match(CODE_FENCE_LINE_RE);
    if (codeFenceMatch) {
      return cursor + codeFenceMatch[0].length;
    }

    const markdownPrefixMatch = remaining.match(MARKDOWN_LINE_PREFIX_RE);
    if (markdownPrefixMatch) {
      cursor += markdownPrefixMatch[0].length;
    }
  }

  while (cursor < buffer.length && !isWhitespace(buffer[cursor])) {
    cursor++;
  }

  return cursor;
}

/**
 * How far the reveal cursor should advance this frame. The character
 * budget is `elapsed * rate`, where the rate is the larger of the calm
 * floor and "whatever drains the current backlog in
 * REVEAL_BACKLOG_DRAIN_MS". The budget is then extended to the next
 * word boundary (via `getNextWordRevealIndex`) so words, code-fence
 * lines, and markdown line prefixes never render half-typed.
 */
function getRevealTargetIndex(refs: StreamRefs, now: number): number {
  const buffer = refs.streamBuffer.current;
  const displayed = refs.displayedTextLength.current;
  const pendingChars = buffer.length - displayed;
  if (pendingChars <= 0 || pendingChars >= REVEAL_FULL_FLUSH_CHARS) {
    return buffer.length;
  }

  const lastFlushAt = refs.lastTextFlushAt.current;
  const elapsedMs = lastFlushAt === 0
    ? REVEAL_MAX_FRAME_MS
    : Math.min(REVEAL_MAX_FRAME_MS, Math.max(REVEAL_MIN_FRAME_MS, now - lastFlushAt));
  const cps = Math.max(
    REVEAL_MIN_CPS,
    pendingChars * (1000 / REVEAL_BACKLOG_DRAIN_MS),
  );
  const budget = Math.max(1, Math.round((cps * elapsedMs) / 1000));
  const target = Math.min(buffer.length, displayed + budget);

  let cursor = displayed;
  while (cursor < target) {
    const next = getNextWordRevealIndex(buffer, cursor);
    if (next <= cursor) return buffer.length;
    cursor = next;
  }
  return cursor;
}

function queueStreamingTextReveal(
  refs: StreamRefs,
  setters: StreamSetters,
  mode: "step" | "full" = "step",
): void {
  if (refs.raf.current !== null) return;

  let ranSynchronously = false;
  const rafId = requestAnimationFrame(() => {
    ranSynchronously = true;
    refs.raf.current = null;
    const nextDisplayedLength = mode === "full"
      ? refs.streamBuffer.current.length
      : getRevealTargetIndex(refs, Date.now());

    applyDisplayedStreamingState(refs, setters, nextDisplayedLength);
    if (mode === "step" && refs.displayedTextLength.current < refs.streamBuffer.current.length) {
      queueStreamingTextReveal(refs, setters);
    }
  });
  refs.raf.current = ranSynchronously ? null : rafId;
}

export function flushStreamingText(refs: StreamRefs, setters: StreamSetters): void {
  cancelPendingStreamFlush(refs);
  applyDisplayedStreamingState(refs, setters, refs.streamBuffer.current.length);
}

export function scheduleStreamingTextReveal(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  if (refs.displayedTextLength.current >= refs.streamBuffer.current.length) return;
  queueStreamingTextReveal(refs, setters);
}

export function resetStreamBuffers(refs: StreamRefs, setters: StreamSetters): void {
  cancelPendingStreamFlush(refs);
  setters.setStreamingText("");
  refs.streamBuffer.current = "";
  refs.displayedTextLength.current = 0;
  refs.lastTextFlushAt.current = 0;
  setters.setThinkingText("");
  refs.thinkingBuffer.current = "";
  refs.thinkingStart.current = null;
  setters.setThinkingDurationMs(null);
  refs.toolCalls.current = [];
  setters.setActiveToolCalls([]);
  refs.timeline.current = [];
  setters.setTimeline([]);
  setters.setProgressText("");
  setters.setIsWriting(false);
  // Reset the generation lifecycle in lockstep with the rest of the
  // stream state so a previous turn's ETA countdown can't outlive the
  // turn that started it. The image/3D/video send paths re-stamp via
  // `setGenerationState` after this runs.
  setters.clearGeneration();
  refs.snapshottedToolCallIds.current = new Set();
}

let _tlId = 0;
export function nextTimelineId(): string {
  return `tl-${++_tlId}`;
}

/**
 * Stamp `durationMs` on the most recent thinking timeline item the
 * moment the segment ends — i.e. when a tool call, assistant text,
 * or stream finalize closes it out. Walks back from the tail and
 * stops at the first non-thinking item, because anything beyond that
 * boundary is already closed.
 *
 * Idempotent: if the segment already has `durationMs` (e.g. two
 * closers fire back-to-back), the second call is a no-op. Safe to
 * call even when no thinking has occurred yet (no-op).
 *
 * Per-segment durations replace the previous turn-level
 * `thinkingDurationMs` that `ActivityTimeline` used to hand to every
 * `ThinkingBlock` — that meant two segments separated by tool calls
 * both showed the same "Thought for X" total instead of their own
 * elapsed time.
 */
export function closeCurrentThinkingSegment(refs: StreamRefs): void {
  const tl = refs.timeline.current;
  for (let i = tl.length - 1; i >= 0; i--) {
    const item = tl[i];
    if (item.kind !== "thinking") return;
    if (item.startMs != null && item.durationMs == null) {
      item.durationMs = Date.now() - item.startMs;
    }
    return;
  }
}

function getSpecDraftContent(tc: ToolCallEntry): string {
  const markdown = tc.input.markdown_contents;
  if (typeof markdown === "string" && markdown.trim()) return markdown;
  const draftPreview = tc.input.draft_preview;
  if (typeof draftPreview === "string" && draftPreview.trim()) return draftPreview;
  return "";
}

function isModelCallTimeout(message: string): boolean {
  return /model call timed out/i.test(message) || /timed out after\s+\d+s/i.test(message);
}

export function pendingToolResult(tc: ToolCallEntry, resolution: PendingToolResolution): string | undefined {
  if (resolution.result === undefined) return undefined;
  if (!resolution.isError || !SPEC_WRITE_TOOL_NAMES.has(tc.name)) {
    return resolution.result;
  }

  const draft = getSpecDraftContent(tc);
  if (!draft) return resolution.result;

  const prefix = isModelCallTimeout(resolution.result)
    ? "Spec draft preserved after model timeout."
    : "Spec draft preserved after stream error.";
  return `${prefix} The draft was not confirmed saved before the stream ended. Copy the markdown above or retry with a smaller spec.\n\n${resolution.result}`;
}

export function resolvePendingToolCallsInEvents(
  setters: StreamSetters,
  resolution: PendingToolResolution,
): void {
  setters.setEvents((prev) => {
    let changed = false;
    const next = prev.map((evt) => {
      if (!evt.toolCalls?.some((tc) => tc.pending)) return evt;
      changed = true;
      return {
        ...evt,
        toolCalls: evt.toolCalls.map((tc) => {
          const result = pendingToolResult(tc, resolution);
          return tc.pending
            ? {
                ...tc,
                pending: false,
                started: false,
                isError: resolution.isError,
                ...(result !== undefined ? { result } : {}),
              }
            : tc;
        }),
      };
    });
    return changed ? next : prev;
  });
}
