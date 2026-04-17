import type { Dispatch, SetStateAction, MutableRefObject } from "react";

/* ------------------------------------------------------------------ */
/*  Display types used across stream hooks and UI components           */
/* ------------------------------------------------------------------ */

export interface DisplayContentBlock {
  type: "text";
  text: string;
}

export interface DisplayImageBlock {
  type: "image";
  media_type: string;
  data: string;
}

export type DisplayContentBlockUnion = DisplayContentBlock | DisplayImageBlock;

export interface ArtifactRef {
  kind: "task" | "spec";
  id: string;
  title: string;
}

export type TimelineItem =
  | { kind: "thinking"; id: string }
  | { kind: "text"; content: string; id: string }
  | { kind: "tool"; toolCallId: string; id: string };

export interface DisplaySessionEvent {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  displayVariant?: "insufficientCreditsError";
  toolCalls?: ToolCallEntry[];
  artifactRefs?: ArtifactRef[];
  contentBlocks?: DisplayContentBlockUnion[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  timeline?: TimelineItem[];
}

export interface ToolCallEntry {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  pending: boolean;
  started?: boolean;
  draft?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Ref / setter interfaces for stream state                           */
/* ------------------------------------------------------------------ */

export interface StreamRefs {
  streamBuffer: MutableRefObject<string>;
  thinkingBuffer: MutableRefObject<string>;
  thinkingStart: MutableRefObject<number | null>;
  toolCalls: MutableRefObject<ToolCallEntry[]>;
  needsSeparator: MutableRefObject<boolean>;
  raf: MutableRefObject<number | null>;
  flushTimeout: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  displayedTextLength: MutableRefObject<number>;
  lastTextFlushAt: MutableRefObject<number>;
  thinkingRaf: MutableRefObject<number | null>;
  timeline: MutableRefObject<TimelineItem[]>;
  snapshottedToolCallIds: MutableRefObject<Set<string>>;
}

export interface StreamSetters {
  setStreamingText: Dispatch<SetStateAction<string>>;
  setThinkingText: Dispatch<SetStateAction<string>>;
  setThinkingDurationMs: Dispatch<SetStateAction<number | null>>;
  setActiveToolCalls: Dispatch<SetStateAction<ToolCallEntry[]>>;
  setEvents: Dispatch<SetStateAction<DisplaySessionEvent[]>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setProgressText: Dispatch<SetStateAction<string>>;
  setTimeline: Dispatch<SetStateAction<TimelineItem[]>>;
}
