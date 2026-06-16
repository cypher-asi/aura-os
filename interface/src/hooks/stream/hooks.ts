import { useStreamStore } from "./store";
import type { DisplaySessionEvent, ToolCallEntry, TimelineItem } from "../../shared/types/stream";

const EMPTY_EVENTS: DisplaySessionEvent[] = [];
const EMPTY_TOOL_CALLS: ToolCallEntry[] = [];
const EMPTY_TIMELINE: TimelineItem[] = [];

export function useStreamEvents(key: string): DisplaySessionEvent[] {
  return useStreamStore((s) => s.entries[key]?.events ?? EMPTY_EVENTS);
}

export function useIsStreaming(key: string): boolean {
  return useStreamStore((s) => s.entries[key]?.isStreaming ?? false);
}

/**
 * True when ANY stream is actively streaming — a global "an operation is in
 * progress" signal for app-level UI (e.g. deferring a blocking overlay until
 * the user's current turn/extraction finishes). Returns a primitive bool so
 * subscribers only re-render when the aggregate flips.
 */
export function useIsAnyStreaming(): boolean {
  return useStreamStore((s) =>
    Object.values(s.entries).some((e) => e.isStreaming),
  );
}

export function useIsWriting(key: string): boolean {
  return useStreamStore((s) => s.entries[key]?.isWriting ?? false);
}

export function useStreamingText(key: string): string {
  return useStreamStore((s) => s.entries[key]?.streamingText ?? "");
}

export function useThinkingText(key: string): string {
  return useStreamStore((s) => s.entries[key]?.thinkingText ?? "");
}

export function useThinkingDurationMs(key: string): number | null {
  return useStreamStore((s) => s.entries[key]?.thinkingDurationMs ?? null);
}

export function useActiveToolCalls(key: string): ToolCallEntry[] {
  return useStreamStore((s) => s.entries[key]?.activeToolCalls ?? EMPTY_TOOL_CALLS);
}

export function useTimeline(key: string): TimelineItem[] {
  return useStreamStore((s) => s.entries[key]?.timeline ?? EMPTY_TIMELINE);
}

export function useProgressText(key: string): string {
  return useStreamStore((s) => s.entries[key]?.progressText ?? "");
}
