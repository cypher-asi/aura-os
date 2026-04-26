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

const WORD_REVEAL_INITIAL_DELAY_MS = 16;
const WORD_REVEAL_INTERVAL_MS = 42;
const WORD_REVEAL_MEDIUM_BACKLOG_INTERVAL_MS = 24;
const WORD_REVEAL_LARGE_BACKLOG_INTERVAL_MS = 12;
const WORD_REVEAL_MAX_BACKLOG_INTERVAL_MS = 8;
const WORD_REVEAL_MEDIUM_BACKLOG_WORDS = 6;
const WORD_REVEAL_LARGE_BACKLOG_WORDS = 12;
const WORD_REVEAL_MAX_BACKLOG_WORDS = 24;
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
  const displayedTimeline: TimelineItem[] = [];
  let remainingVisibleText = visibleText;

  for (const item of refs.timeline.current) {
    if (item.kind !== "text") {
      displayedTimeline.push({ ...item });
      continue;
    }

    if (!remainingVisibleText) continue;

    const visibleSegment = remainingVisibleText.slice(
      0,
      Math.min(item.content.length, remainingVisibleText.length),
    );
    remainingVisibleText = remainingVisibleText.slice(visibleSegment.length);
    if (visibleSegment.length > 0) {
      displayedTimeline.push({ ...item, content: visibleSegment });
    }
  }

  return displayedTimeline;
}

function updateWritingFlag(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  const writing =
    refs.displayedTextLength.current < refs.streamBuffer.current.length;
  setters.setIsWriting(writing);
}

export function syncDisplayedTimeline(
  refs: StreamRefs,
  setters: StreamSetters,
): void {
  setters.setTimeline(buildDisplayedTimeline(refs, getDisplayedStreamingText(refs)));
}

function applyDisplayedStreamingState(
  refs: StreamRefs,
  setters: StreamSetters,
  displayedTextLength: number,
): void {
  refs.displayedTextLength.current = displayedTextLength;
  refs.lastTextFlushAt.current = Date.now();

  const visibleText = getDisplayedStreamingText(refs);
  setters.setStreamingText(visibleText);
  setters.setTimeline(buildDisplayedTimeline(refs, visibleText));
  updateWritingFlag(refs, setters);
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

function getPendingRevealWordCount(refs: StreamRefs): number {
  const hiddenText = refs.streamBuffer.current.slice(refs.displayedTextLength.current);
  const matches = hiddenText.match(/\S+/g);
  return matches ? matches.length : 0;
}

function getWordRevealDelayMs(refs: StreamRefs): number {
  if (refs.displayedTextLength.current === 0) {
    return WORD_REVEAL_INITIAL_DELAY_MS;
  }

  const pendingWords = getPendingRevealWordCount(refs);
  if (pendingWords >= WORD_REVEAL_MAX_BACKLOG_WORDS) {
    return WORD_REVEAL_MAX_BACKLOG_INTERVAL_MS;
  }
  if (pendingWords >= WORD_REVEAL_LARGE_BACKLOG_WORDS) {
    return WORD_REVEAL_LARGE_BACKLOG_INTERVAL_MS;
  }
  if (pendingWords >= WORD_REVEAL_MEDIUM_BACKLOG_WORDS) {
    return WORD_REVEAL_MEDIUM_BACKLOG_INTERVAL_MS;
  }
  return WORD_REVEAL_INTERVAL_MS;
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
      : getNextWordRevealIndex(refs.streamBuffer.current, refs.displayedTextLength.current);

    applyDisplayedStreamingState(refs, setters, nextDisplayedLength);
    if (mode === "step" && refs.displayedTextLength.current < refs.streamBuffer.current.length) {
      scheduleStreamingTextReveal(refs, setters);
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
  if (refs.raf.current !== null || refs.flushTimeout.current !== null) return;
  if (refs.displayedTextLength.current >= refs.streamBuffer.current.length) return;

  refs.flushTimeout.current = setTimeout(() => {
    refs.flushTimeout.current = null;
    queueStreamingTextReveal(refs, setters);
  }, getWordRevealDelayMs(refs));
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
  refs.snapshottedToolCallIds.current = new Set();
}

let _tlId = 0;
export function nextTimelineId(): string {
  return `tl-${++_tlId}`;
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
