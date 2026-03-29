import { useStreamStore } from "./store";
import type { DisplaySessionEvent, ToolCallEntry, TimelineItem } from "../../types/stream";

const EMPTY_EVENTS: DisplaySessionEvent[] = [];
const EMPTY_TOOL_CALLS: ToolCallEntry[] = [];
const EMPTY_TIMELINE: TimelineItem[] = [];

export function useStreamEvents(key: string): DisplaySessionEvent[] {
  return useStreamStore((s) => s.entries[key]?.events ?? EMPTY_EVENTS);
}

export function useIsStreaming(key: string): boolean {
  return useStreamStore((s) => s.entries[key]?.isStreaming ?? false);
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
