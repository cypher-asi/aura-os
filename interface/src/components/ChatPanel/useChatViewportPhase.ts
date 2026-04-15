import { useEffect, useState } from "react";

const PRE_REVEAL_SCROLL_FRAMES = 2;
const MAX_SETTLE_SCROLL_FRAMES = 12;
const BOTTOM_THRESHOLD_PX = 4;
const INPUT_OVERLAY_PX = 140;
const UNSET_READY_KEY = Symbol("unset-ready-key");

function isSentinelBelowViewport(
  sentinel: HTMLElement,
  container: HTMLElement,
): boolean {
  const sRect = sentinel.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  return sRect.top > cRect.bottom - INPUT_OVERLAY_PX;
}

function isAnchoredAtBottom(
  container: HTMLElement | null,
  sentinel: HTMLElement | null,
): boolean {
  if (!container) {
    return false;
  }
  if (sentinel) {
    return !isSentinelBelowViewport(sentinel, container);
  }
  return container.scrollHeight - container.scrollTop - container.clientHeight < BOTTOM_THRESHOLD_PX;
}

interface UseChatViewportPhaseOptions {
  contentReady: boolean;
  hasMessages: boolean;
  tailLayoutReady: boolean;
  layoutRevision: number;
  resetKey?: unknown;
  scrollToBottom: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  sentinelRef: React.RefObject<HTMLElement | null>;
}

export function useChatViewportPhase({
  contentReady,
  hasMessages,
  tailLayoutReady,
  layoutRevision,
  resetKey,
  scrollToBottom,
  containerRef,
  sentinelRef,
}: UseChatViewportPhaseOptions): {
  isReady: boolean;
} {
  const [readyKey, setReadyKey] = useState<unknown>(UNSET_READY_KEY);
  const readyForCurrentKey = Object.is(readyKey, resetKey);
  const isReady = hasMessages ? readyForCurrentKey : contentReady;

  useEffect(() => {
    if (readyForCurrentKey || !contentReady || !hasMessages || !tailLayoutReady) {
      return;
    }

    let cancelled = false;
    let raf = 0;
    let remainingWarmupFrames = PRE_REVEAL_SCROLL_FRAMES;
    let settleAttempts = 0;

    const settle = () => {
      if (cancelled) {
        return;
      }

      scrollToBottom();

      const anchored = isAnchoredAtBottom(containerRef.current, sentinelRef.current);
      const shouldContinueSettling =
        remainingWarmupFrames > 0 || (!anchored && settleAttempts < MAX_SETTLE_SCROLL_FRAMES);
      if (shouldContinueSettling) {
        remainingWarmupFrames = Math.max(0, remainingWarmupFrames - 1);
        settleAttempts += 1;
        raf = requestAnimationFrame(settle);
        return;
      }

      setReadyKey(resetKey);
    };

    raf = requestAnimationFrame(settle);

    return () => {
      cancelled = true;
      if (raf !== 0) {
        cancelAnimationFrame(raf);
      }
    };
  }, [
    containerRef,
    contentReady,
    hasMessages,
    layoutRevision,
    readyForCurrentKey,
    resetKey,
    scrollToBottom,
    sentinelRef,
    tailLayoutReady,
  ]);

  return { isReady };
}
