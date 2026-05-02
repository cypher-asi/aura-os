import { useCallback, useLayoutEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 40;
const INPUT_OVERLAY_PX = 140;
const EXIT_FOLLOW_THRESHOLD_PX = BOTTOM_THRESHOLD_PX + INPUT_OVERLAY_PX + 48;
const ENTER_FOLLOW_THRESHOLD_PX = BOTTOM_THRESHOLD_PX + INPUT_OVERLAY_PX;

export interface UseScrollAnchorV2Return {
  handleScroll: () => void;
  scrollToBottom: () => void;
  isAutoFollowing: boolean;
}

/**
 * Tracks whether the user is pinned to the bottom of a scroll container, and
 * exposes an imperative `scrollToBottom` for handoffs (thread switch, send,
 * click-to-jump). Anchor preservation when content above the viewport changes
 * size (lane resize, loading older messages) is delegated to native CSS
 * `overflow-anchor`; this hook owns only the bits the browser can't do for us.
 */
export function useScrollAnchorV2(
  ref: React.RefObject<HTMLElement | null>,
  options: { resetKey?: unknown; scrollToBottomOnReset?: boolean },
): UseScrollAnchorV2Return {
  const { resetKey, scrollToBottomOnReset = true } = options;

  const pinnedRef = useRef(true);
  const guardRef = useRef(false);
  const [isAutoFollowing, setIsAutoFollowing] = useState(true);

  const syncFollowState = useCallback(() => {
    const next = pinnedRef.current;
    setIsAutoFollowing((prev) => (prev === next ? prev : next));
  }, []);

  const guardedScrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom <= 1) return;
    guardRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      guardRef.current = false;
    });
  }, [ref]);

  useLayoutEffect(() => {
    pinnedRef.current = true;
    syncFollowState();
    if (scrollToBottomOnReset) {
      guardedScrollToBottom();
    }
  }, [resetKey, guardedScrollToBottom, scrollToBottomOnReset, syncFollowState]);

  const handleScroll = useCallback(() => {
    if (guardRef.current) return;
    const el = ref.current;
    if (!el) return;

    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const threshold = pinnedRef.current
      ? EXIT_FOLLOW_THRESHOLD_PX
      : ENTER_FOLLOW_THRESHOLD_PX;
    const nextPinned = distFromBottom < threshold;

    if (pinnedRef.current !== nextPinned) {
      pinnedRef.current = nextPinned;
      syncFollowState();
    }
  }, [ref, syncFollowState]);

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    syncFollowState();
    guardedScrollToBottom();
  }, [guardedScrollToBottom, syncFollowState]);

  return { handleScroll, scrollToBottom, isAutoFollowing };
}
