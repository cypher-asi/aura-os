import type { SetStateAction } from "react";
import type {
  DisplayMessage,
  ToolCallEntry,
  TimelineItem,
  StreamRefs,
  StreamSetters,
} from "../../types/stream";

/* ------------------------------------------------------------------ */
/*  Module-level stream store                                          */
/*                                                                     */
/*  Keeps stream state alive across React mount/unmount cycles so      */
/*  navigating away from a chat and returning restores the live        */
/*  stream instead of aborting it.                                     */
/* ------------------------------------------------------------------ */

export interface StreamEntry {
  key: string;
  refs: StreamRefs;
  abort: AbortController | null;
  isStreaming: boolean;
  messages: DisplayMessage[];
  streamingText: string;
  thinkingText: string;
  thinkingDurationMs: number | null;
  activeToolCalls: ToolCallEntry[];
  timeline: TimelineItem[];
  progressText: string;
  /** Current React setters – null when the component is unmounted. */
  reactSetters: StreamSetters | null;
}

export const streamStore = new Map<string, StreamEntry>();

export function storeKey(deps: unknown[]): string {
  return deps.filter(Boolean).join(":");
}

export function makeEntry(key: string): StreamEntry {
  return {
    key,
    refs: {
      streamBuffer: { current: "" },
      thinkingBuffer: { current: "" },
      thinkingStart: { current: null },
      toolCalls: { current: [] },
      needsSeparator: { current: false },
      raf: { current: null },
      thinkingRaf: { current: null },
      timeline: { current: [] },
    },
    abort: null,
    isStreaming: false,
    messages: [],
    streamingText: "",
    thinkingText: "",
    thinkingDurationMs: null,
    activeToolCalls: [],
    timeline: [],
    progressText: "",
    reactSetters: null,
  };
}

export function resolve<T>(action: SetStateAction<T>, prev: T): T {
  return typeof action === "function"
    ? (action as (p: T) => T)(prev)
    : action;
}

/**
 * Create proxy setters that always update the persistent entry snapshot
 * and forward to React when the component is mounted.
 */
export function createProxySetters(entry: StreamEntry): StreamSetters {
  return {
    setStreamingText(v) {
      entry.streamingText = resolve(v, entry.streamingText);
      entry.reactSetters?.setStreamingText(entry.streamingText);
    },
    setThinkingText(v) {
      entry.thinkingText = resolve(v, entry.thinkingText);
      entry.reactSetters?.setThinkingText(entry.thinkingText);
    },
    setThinkingDurationMs(v) {
      entry.thinkingDurationMs = resolve(v, entry.thinkingDurationMs);
      entry.reactSetters?.setThinkingDurationMs(entry.thinkingDurationMs);
    },
    setActiveToolCalls(v) {
      entry.activeToolCalls = resolve(v, entry.activeToolCalls);
      entry.reactSetters?.setActiveToolCalls(entry.activeToolCalls);
    },
    setMessages(v) {
      entry.messages = resolve(v, entry.messages);
      entry.reactSetters?.setMessages(entry.messages);
    },
    setIsStreaming(v) {
      entry.isStreaming = resolve(v, entry.isStreaming);
      entry.reactSetters?.setIsStreaming(entry.isStreaming);
    },
    setProgressText(v) {
      entry.progressText = resolve(v, entry.progressText);
      entry.reactSetters?.setProgressText(entry.progressText);
    },
    setTimeline(v) {
      entry.timeline = resolve(v, entry.timeline);
      entry.reactSetters?.setTimeline(entry.timeline);
    },
  };
}
