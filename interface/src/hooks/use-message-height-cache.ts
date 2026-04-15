import { useRef, useCallback } from "react";
import type { DisplaySessionEvent } from "../types/stream";

type EstimateHint = {
  role: "user" | "assistant" | "system";
  hasCodeBlocks?: boolean;
  hasImages?: boolean;
  contentLength?: number;
  hasToolCalls?: boolean;
  hasThinking?: boolean;
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
  return {
    role: msg.role,
    contentLength: msg.content?.length ?? 0,
    hasCodeBlocks: msg.content?.includes("```") ?? false,
    hasImages: (msg.contentBlocks ?? []).some(
      (b) => "type" in b && (b as { type: string }).type === "image",
    ),
    hasToolCalls: (msg.toolCalls?.length ?? 0) > 0,
    hasThinking: Boolean(msg.thinkingText),
  };
}

function estimateFromHint(hint: EstimateHint): number {
  if (hint.role === "system") return HEIGHT_ESTIMATES.system;

  if (hint.role === "user") {
    const len = hint.contentLength ?? 0;
    if (len < 60) return HEIGHT_ESTIMATES.user_short;
    if (len < 200) return HEIGHT_ESTIMATES.user_medium;
    return HEIGHT_ESTIMATES.user_long;
  }

  if (hint.hasImages) return HEIGHT_ESTIMATES.assistant_image;
  if (hint.hasCodeBlocks) return HEIGHT_ESTIMATES.assistant_code;

  let base: number;
  const len = hint.contentLength ?? 0;
  if (len < 100) base = HEIGHT_ESTIMATES.assistant_short;
  else if (len < 500) base = HEIGHT_ESTIMATES.assistant_medium;
  else base = HEIGHT_ESTIMATES.assistant_long;

  if (hint.hasToolCalls) base += 60;
  if (hint.hasThinking) base += 40;
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
