import { useEffect, useLayoutEffect, useState } from "react";

const PRE_REVEAL_SCROLL_FRAMES = 2;
const BOTTOM_THRESHOLD_PX = 4;
const INPUT_OVERLAY_PX = 140;

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
  const [isReady, setIsReady] = useState(false);

  useLayoutEffect(() => {
    setIsReady(false);
  }, [resetKey]);

  useEffect(() => {
    if (isReady) {
      return;
    }

    if (!contentReady) {
      setIsReady(false);
      return;
    }

    if (!hasMessages) {
      setIsReady(true);
      return;
    }

    if (!tailLayoutReady) {
      setIsReady(false);
      return;
    }

    let cancelled = false;
    let raf = 0;
    let remainingWarmupFrames = PRE_REVEAL_SCROLL_FRAMES;

    const settle = () => {
      if (cancelled) {
        return;
      }

      scrollToBottom();

      const anchored = isAnchoredAtBottom(containerRef.current, sentinelRef.current);
      if (remainingWarmupFrames > 0 || !anchored) {
        remainingWarmupFrames = Math.max(0, remainingWarmupFrames - 1);
        raf = requestAnimationFrame(settle);
        return;
      }

      setIsReady(true);
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
    isReady,
    layoutRevision,
    resetKey,
    scrollToBottom,
    sentinelRef,
    tailLayoutReady,
  ]);

  return { isReady };
}
