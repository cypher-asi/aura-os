import { useRef, useCallback } from "react";
import type { DisplaySessionEvent } from "../types/stream";

type EstimateHint = {
  role: "user" | "assistant" | "system";
  hasCodeBlocks?: boolean;
  hasImages?: boolean;
  contentLength?: number;
  contentLineCount?: number;
  paragraphCount?: number;
  headingCount?: number;
  listItemCount?: number;
  quoteCount?: number;
  tableRowCount?: number;
  hasToolCalls?: boolean;
  toolCallCount?: number;
  hasThinking?: boolean;
  thinkingLength?: number;
  artifactCount?: number;
  timelineItemCount?: number;
  textTimelineCount?: number;
  fileAttachment?: boolean;
  displayVariant?: "insufficientCreditsError";
};

const HEIGHT_ESTIMATES = {
  user_short: 52,
  user_medium: 80,
  user_long: 120,
  assistant_short: 80,
  assistant_medium: 160,
  assistant_long: 300,
  assistant_code: 320,
  assistant_image: 400,
  system: 48,
};

function hintFromMessage(msg: DisplaySessionEvent): EstimateHint {
  const content = msg.content ?? "";
  const contentBlocks = msg.contentBlocks ?? [];
  const imageCount = contentBlocks.filter(
    (b) => "type" in b && (b as { type: string }).type === "image",
  ).length;
  const lineCount = content.length === 0 ? 0 : content.split("\n").length;
  const paragraphCount = content.length === 0
    ? 0
    : content
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean)
      .length;
  const headingCount = (content.match(/^#{1,6}\s+/gm) ?? []).length;
  const listItemCount = (content.match(/^\s*(?:[-*+]|\d+\.)\s+/gm) ?? []).length;
  const quoteCount = (content.match(/^\s*>\s+/gm) ?? []).length;
  const tableRowCount = content.includes("|")
    ? content
      .split("\n")
      .filter((line) => line.includes("|") && line.trim().length > 0)
      .length
    : 0;
  const toolCallCount = msg.toolCalls?.length ?? 0;
  const thinkingLength = msg.thinkingText?.length ?? 0;
  const timeline = msg.timeline ?? [];
  const textTimelineCount = timeline.filter((item) => item.kind === "text").length;

  return {
    role: msg.role,
    contentLength: content.length,
    contentLineCount: lineCount,
    paragraphCount,
    headingCount,
    listItemCount,
    quoteCount,
    tableRowCount,
    hasCodeBlocks: content.includes("```"),
    hasImages: imageCount > 0,
    hasToolCalls: toolCallCount > 0,
    toolCallCount,
    hasThinking: Boolean(msg.thinkingText),
    thinkingLength,
    artifactCount: msg.artifactRefs?.length ?? 0,
    timelineItemCount: timeline.length,
    textTimelineCount,
    fileAttachment: /^\[File:\s*(.+?)\]\n\n/.test(content),
    displayVariant: msg.displayVariant,
  };
}

function estimateFromHint(hint: EstimateHint): number {
  if (hint.role === "system") return HEIGHT_ESTIMATES.system;

  if (hint.role === "user") {
    const len = hint.contentLength ?? 0;
    let base: number;
    if (hint.hasImages) {
      base = 320;
    } else if (hint.fileAttachment) {
      base = 180;
    } else if (len < 60) {
      base = HEIGHT_ESTIMATES.user_short;
    } else if (len < 200) {
      base = HEIGHT_ESTIMATES.user_medium;
    } else {
      base = HEIGHT_ESTIMATES.user_long;
    }

    base += Math.min((hint.contentLineCount ?? 0) * 4, 48);
    return base;
  }

  let base: number;
  const len = hint.contentLength ?? 0;
  if (hint.hasImages) {
    base = HEIGHT_ESTIMATES.assistant_image;
  } else if (hint.hasCodeBlocks) {
    base = HEIGHT_ESTIMATES.assistant_code;
  } else if (len < 100) {
    base = HEIGHT_ESTIMATES.assistant_short;
  } else if (len < 500) {
    base = HEIGHT_ESTIMATES.assistant_medium;
  } else {
    base = HEIGHT_ESTIMATES.assistant_long;
  }

  base += Math.min((hint.contentLineCount ?? 0) * 3, 120);
  base += Math.min((hint.paragraphCount ?? 0) * 18, 90);
  base += (hint.headingCount ?? 0) * 20;
  base += Math.min((hint.listItemCount ?? 0) * 12, 96);
  base += Math.min((hint.quoteCount ?? 0) * 14, 56);
  base += Math.min((hint.tableRowCount ?? 0) * 22, 132);
  base += Math.min((hint.textTimelineCount ?? 0) * 18, 72);
  base += Math.min((hint.timelineItemCount ?? 0) * 28, 140);
  base += Math.min((hint.toolCallCount ?? 0) * 110, 440);
  base += Math.min((hint.artifactCount ?? 0) * 36, 108);
  if (hint.hasThinking) {
    base += 52 + Math.min(Math.ceil((hint.thinkingLength ?? 0) / 140) * 16, 96);
  }
  if (hint.displayVariant === "insufficientCreditsError") {
    base += 72;
  }
  return base;
}

export interface MessageHeightCache {
  getHeight: (id: string) => number | undefined;
  setHeight: (id: string, height: number) => void;
  estimateHeight: (msg: DisplaySessionEvent) => number;
}

export function useMessageHeightCache(): MessageHeightCache {
  const mapRef = useRef<Map<string, number>>(new Map());

  const getHeight = useCallback((id: string): number | undefined => {
    return mapRef.current.get(id);
  }, []);

  const setHeight = useCallback((id: string, height: number): void => {
    const current = mapRef.current.get(id);
    if (current !== undefined && Math.abs(current - height) < 1) return;
    mapRef.current.set(id, height);
  }, []);

  const estimateHeight = useCallback((msg: DisplaySessionEvent): number => {
    return estimateFromHint(hintFromMessage(msg));
  }, []);

  return useRef<MessageHeightCache>({ getHeight, setHeight, estimateHeight })
    .current;
}
