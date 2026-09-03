import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 40;
const INPUT_OVERLAY_PX = 140;
const EXIT_FOLLOW_THRESHOLD_PX = BOTTOM_THRESHOLD_PX + INPUT_OVERLAY_PX + 48;
const ENTER_FOLLOW_THRESHOLD_PX = BOTTOM_THRESHOLD_PX + INPUT_OVERLAY_PX;

const UPWARD_SCROLL_KEYS = new Set([
  "ArrowUp",
  "PageUp",
  "Home",
]);

// Minimum upward `scrollTop` delta (px) within a single scroll event that we
// treat as deliberate user intent. Small enough to catch a gentle scrollbar
// nudge, large enough to ignore sub-pixel jitter from layout/scrollHeight
// changes on high-DPI displays.
const UPWARD_INTENT_EPSILON_PX = 2;

export interface UseScrollAnchorV2Return {
  handleScroll: () => void;
  scrollToBottom: () => void;
  isAutoFollowing: boolean;
  /**
   * Returns the `performance.now()` timestamp of the user's most recent
   * explicit scroll-up gesture (wheel up, swipe down, ArrowUp/PageUp/Home),
   * or `0` if the user is currently considered pinned. Auto-pin paths in
   * downstream components consult this to suppress repinning the moment
   * the user has shown intent to read older content, even if a streaming
   * layout flush would otherwise drag the viewport back to the bottom.
   */
  getUserUnpinnedAt: () => number;
}

/**
 * Tracks whether the user is pinned to the bottom of a scroll container, and
 * exposes an imperative `scrollToBottom` for handoffs (thread switch, send,
 * click-to-jump). Anchor preservation when content above the viewport changes
 * size (lane resize, loading older messages) is delegated to native CSS
 * `overflow-anchor`; this hook owns only the bits the browser can't do for us.
 *
 * Beyond pure position tracking, the hook also listens for explicit upward
 * scroll intent (wheel/touch/keyboard) on the container in the capture
 * phase. Detecting intent rather than waiting for the resulting scroll
 * position lets us disengage auto-follow synchronously, so a streaming
 * `useLayoutEffect` (or post-stream image-pin window) cannot fight a
 * partial drag. See `getUserUnpinnedAt` on the return type.
 */
export function useScrollAnchorV2(
  ref: React.RefObject<HTMLElement | null>,
  options: { resetKey?: unknown; scrollToBottomOnReset?: boolean },
): UseScrollAnchorV2Return {
  const { resetKey, scrollToBottomOnReset = true } = options;

  const pinnedRef = useRef(true);
  const guardRef = useRef(false);
  const userUnpinnedAtRef = useRef(0);
  const lastTouchYRef = useRef<number | null>(null);
  const lastScrollTopRef = useRef(0);
  const lastMaxScrollTopRef = useRef(0);
  const [isAutoFollowing, setIsAutoFollowing] = useState(true);

  const syncFollowState = useCallback(() => {
    const next = pinnedRef.current;
    setIsAutoFollowing((prev) => (prev === next ? prev : next));
  }, []);

  const guardedScrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom <= 1) {
      // Already pinned; still refresh the baseline so the next genuine scroll
      // event measures its upward delta against the true bottom rather than a
      // stale value (e.g. the initial 0).
      lastScrollTopRef.current = el.scrollTop;
      lastMaxScrollTopRef.current = Math.max(0, el.scrollHeight - el.clientHeight);
      return;
    }
    guardRef.current = true;
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
    lastMaxScrollTopRef.current = Math.max(0, el.scrollHeight - el.clientHeight);
    requestAnimationFrame(() => {
      guardRef.current = false;
    });
  }, [ref]);

  useLayoutEffect(() => {
    pinnedRef.current = true;
    userUnpinnedAtRef.current = 0;
    lastScrollTopRef.current = ref.current?.scrollTop ?? 0;
    lastMaxScrollTopRef.current = ref.current
      ? Math.max(0, ref.current.scrollHeight - ref.current.clientHeight)
      : 0;
    syncFollowState();
    if (scrollToBottomOnReset) {
      guardedScrollToBottom();
    }
  }, [ref, resetKey, guardedScrollToBottom, scrollToBottomOnReset, syncFollowState]);

  const markUserUnpinned = useCallback(() => {
    userUnpinnedAtRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    if (pinnedRef.current) {
      pinnedRef.current = false;
      syncFollowState();
    }
  }, [syncFollowState]);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    if (guardRef.current) {
      // Our own scrollToBottom write. Keep the baseline current so the next
      // genuine scroll event measures its delta against the right position.
      lastScrollTopRef.current = el.scrollTop;
      lastMaxScrollTopRef.current = Math.max(0, el.scrollHeight - el.clientHeight);
      return;
    }

    // An upward scrollTop movement can be user intent (scrollbar drag, track
    // click, middle-click autoscroll), but it can also be a browser clamp when
    // virtualized rows shrink or the viewport grows. Compare the movement to
    // the change in the element's maximum valid scrollTop so geometry-only
    // corrections do not silently disable follow while a response streams.
    // Any upward movement beyond that clamp allowance is still genuine intent
    // and follows the same sticky unpin path as wheel/touch/keyboard.
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const upwardDelta = lastScrollTopRef.current - el.scrollTop;
    const maxScrollTopDecrease = Math.max(
      0,
      lastMaxScrollTopRef.current - maxScrollTop,
    );
    const userDrivenUpwardDelta = upwardDelta - maxScrollTopDecrease;
    lastScrollTopRef.current = el.scrollTop;
    lastMaxScrollTopRef.current = maxScrollTop;
    if (
      userDrivenUpwardDelta > UPWARD_INTENT_EPSILON_PX &&
      userUnpinnedAtRef.current === 0
    ) {
      markUserUnpinned();
      return;
    }

    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

    // Once the user has shown explicit upward intent, keep auto-follow off
    // for the remainder of this posting session. Merely reaching the bottom
    // again must not silently re-arm it: a late token/layout flush could do
    // that on the user's behalf and resume fighting their reading position.
    // The next send (or an explicit jump-to-bottom click) calls
    // `scrollToBottom`, which starts a fresh follow session.
    if (userUnpinnedAtRef.current > 0) {
      return;
    }

    const threshold = pinnedRef.current
      ? EXIT_FOLLOW_THRESHOLD_PX
      : ENTER_FOLLOW_THRESHOLD_PX;
    const nextPinned = distFromBottom < threshold;

    if (pinnedRef.current !== nextPinned) {
      pinnedRef.current = nextPinned;
      syncFollowState();
    }
  }, [ref, syncFollowState, markUserUnpinned]);

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    userUnpinnedAtRef.current = 0;
    syncFollowState();
    guardedScrollToBottom();
  }, [guardedScrollToBottom, syncFollowState]);

  // Explicit upward intent: wheel up, swipe down (which scrolls content up),
  // or PageUp/ArrowUp/Home keypresses on the container. Capture phase so we
  // run before any descendant cancels the event, and synchronously so we
  // win the race against streaming `useLayoutEffect` flushes.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0) markUserUnpinned();
    };
    const onTouchStart = (event: TouchEvent): void => {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent): void => {
      const prev = lastTouchYRef.current;
      const next = event.touches[0]?.clientY ?? null;
      if (prev != null && next != null && next > prev) {
        // Finger moved downward → page scrolls upward → reading older content.
        markUserUnpinned();
      }
      lastTouchYRef.current = next;
    };
    const onTouchEnd = (): void => {
      lastTouchYRef.current = null;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (UPWARD_SCROLL_KEYS.has(event.key)) {
        markUserUnpinned();
        return;
      }
      if (event.key === " " && event.shiftKey) {
        markUserUnpinned();
      }
    };

    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    el.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    el.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: true,
    });
    el.addEventListener("touchend", onTouchEnd, { capture: true, passive: true });
    el.addEventListener("touchcancel", onTouchEnd, {
      capture: true,
      passive: true,
    });
    el.addEventListener("keydown", onKeyDown, { capture: true });

    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
      el.removeEventListener("touchstart", onTouchStart, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("touchmove", onTouchMove, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("touchend", onTouchEnd, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("touchcancel", onTouchEnd, {
        capture: true,
      } as EventListenerOptions);
      el.removeEventListener("keydown", onKeyDown, {
        capture: true,
      } as EventListenerOptions);
    };
  }, [ref, markUserUnpinned]);

  const getUserUnpinnedAt = useCallback(() => userUnpinnedAtRef.current, []);

  return { handleScroll, scrollToBottom, isAutoFollowing, getUserUnpinnedAt };
}
