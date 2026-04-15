import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";

const BOTTOM_THRESHOLD_PX = 40;
const USER_SCROLL_ESCAPE_PX = 80;
const STABLE_FRAMES_REQUIRED = 3;
const SETTLE_TIMEOUT_MS = 2000;
const MAX_WAIT_FRAMES = 10;
const INPUT_OVERLAY_PX = 140;

/**
 * Sets `el.scrollTop` and guards the next scroll event so it isn't
 * misread as user-initiated (which would unpin auto-scroll when
 * scrollHeight grows between the assignment and the event).
 */
function guardedScroll(
  el: HTMLElement,
  target: number,
  guardRef: React.MutableRefObject<boolean>,
) {
  guardRef.current = true;
  el.scrollTop = target;
  requestAnimationFrame(() => {
    guardRef.current = false;
  });
}

/**
 * Returns true when the sentinel (content-end marker) is below the
 * visible area of the scroll container, accounting for the input overlay.
 */
function isSentinelBelowViewport(
  sentinel: HTMLElement,
  container: HTMLElement,
): boolean {
  const sRect = sentinel.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  return sRect.top > cRect.bottom - INPUT_OVERLAY_PX;
}

function isContainerAtBottom(
  container: HTMLElement,
  sentinel: HTMLElement | null,
): boolean {
  if (sentinel) {
    return !isSentinelBelowViewport(sentinel, container);
  }
  return container.scrollHeight - container.scrollTop - container.clientHeight < BOTTOM_THRESHOLD_PX;
}

/**
 * Manages scroll behaviour for a chat message container backed by a
 * virtualised list with dynamic row heights. Uses a sentinel element
 * placed at the end of real content (before any spacer) as the
 * canonical "bottom of content" reference.
 *
 * Operates in two phases:
 *
 *   **Settling** – entered on mount / `resetKey` change. A tight RAF
 *   loop waits for fetched content and, when available, for a
 *   virtualized layout signal that says the bottom-rendered range has
 *   converged before revealing the list.
 *
 *   **Active** – content is visible. MutationObserver and
 *   ResizeObservers keep the sentinel pinned to the viewport bottom
 *   while new content streams in, unless the user scrolls up.
 */
export function useScrollAnchor(
  ref: React.RefObject<HTMLElement | null>,
  sentinelRef: React.RefObject<HTMLElement | null>,
  options: {
    resetKey?: unknown;
    contentReady: boolean;
    layoutState?: {
      signature: string;
      coversTail: boolean;
    } | null;
  },
): {
  handleScroll: () => void;
  scrollToBottom: () => void;
  scrollToBottomIfPinned: () => void;
  isReady: boolean;
  isAutoFollowing: boolean;
} {
  const { resetKey, contentReady, layoutState = null } = options;

  const pinnedRef = useRef(true);
  const phaseRef = useRef<"settling" | "active">("settling");
  const guardRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const hasBeenReadyRef = useRef(false);

  const [isReady, setIsReady] = useState(false);
  const [isAutoFollowing, setIsAutoFollowing] = useState(true);
  const isReadyRef = useRef(false);

  const contentReadyRef = useRef(contentReady);
  useLayoutEffect(() => { contentReadyRef.current = contentReady; }, [contentReady]);
  const layoutStateRef = useRef(layoutState);
  useLayoutEffect(() => { layoutStateRef.current = layoutState; }, [layoutState]);

  const syncFollowState = useCallback(() => {
    const next = phaseRef.current !== "active"
      ? true
      : pinnedRef.current;
    setIsAutoFollowing((prev) => (prev === next ? prev : next));
  }, []);

  /** Scroll sentinel to the bottom of the visible area (above input overlay). */
  const scrollSentinelToEnd = useCallback(() => {
    const el = ref.current;
    if (el) guardedScroll(el, el.scrollHeight, guardRef);
  }, [ref]);

  // ── Settling phase ──────────────────────────────────────────────────
  // useLayoutEffect so that on resetKey change the skipSettle fast-path
  // scrolls to the bottom *before* the browser paints (prevents a single
  // visible frame with new content at the old scroll position).
  useLayoutEffect(() => {
    const skipSettle = hasBeenReadyRef.current;

    phaseRef.current = "settling";
    pinnedRef.current = true;
    syncFollowState();

    if (skipSettle) {
      // Already shown once -- keep chrome visible and just re-anchor scroll.
      const el = ref.current;
      if (el) {
        scrollSentinelToEnd();
        prevScrollHeightRef.current = el.scrollHeight;
        lastScrollTopRef.current = el.scrollTop;
      }
      phaseRef.current = "active";
      isReadyRef.current = true;
      setIsReady(true);
      syncFollowState();
      return;
    }

    setIsReady(false);
    isReadyRef.current = false;

    const el = ref.current;
    if (!el) return;

    lastScrollTopRef.current = el.scrollTop;

    let prevHeight = el.scrollHeight;
    let prevLayoutSignature = layoutStateRef.current?.signature ?? null;
    let stableFrames = 0;
    let sawMeasuredLayout = layoutStateRef.current !== null;
    let waitingFrames = 0;
    let raf = 0;

    const reveal = () => {
      if (isReadyRef.current) return;
      scrollSentinelToEnd();
      prevScrollHeightRef.current = el.scrollHeight;
      phaseRef.current = "active";
      setIsReady(true);
      isReadyRef.current = true;
      hasBeenReadyRef.current = true;
      syncFollowState();
    };

    const poll = () => {
      if (isReadyRef.current) return;

      if (!contentReadyRef.current) {
        raf = requestAnimationFrame(poll);
        return;
      }

      const layout = layoutStateRef.current;
      const sentinel = sentinelRef.current;
      const h = el.scrollHeight;
      const layoutSignature = layout?.signature ?? null;
      const hasLayoutSignal = layout !== null;
      const layoutChanged = layoutSignature !== prevLayoutSignature;
      const coversTail = layout?.coversTail ?? false;
      const heightChanged = h !== prevHeight;
      const anchoredAtBottom = isContainerAtBottom(el, sentinel);

      prevLayoutSignature = layoutSignature;

      if (hasLayoutSignal) {
        if (layoutChanged) {
          sawMeasuredLayout = true;
          stableFrames = 0;
          waitingFrames = 0;
          scrollSentinelToEnd();
        } else if (!coversTail || !anchoredAtBottom) {
          stableFrames = 0;
          waitingFrames = 0;
          scrollSentinelToEnd();
        } else if (sawMeasuredLayout) {
          stableFrames++;
        } else {
          waitingFrames++;
        }

        prevHeight = h;

        if (stableFrames >= STABLE_FRAMES_REQUIRED) {
          reveal();
          return;
        }
        raf = requestAnimationFrame(poll);
        return;
      }

      if (h !== prevHeight) {
        stableFrames = 0;
        prevHeight = h;
        scrollSentinelToEnd();
        sawMeasuredLayout = true;
      } else if (!anchoredAtBottom) {
        stableFrames = 0;
        waitingFrames = 0;
        scrollSentinelToEnd();
      } else if (sawMeasuredLayout) {
        stableFrames++;
      } else {
        waitingFrames++;
      }

      if (stableFrames >= STABLE_FRAMES_REQUIRED) {
        reveal();
        return;
      }
      if (!heightChanged && waitingFrames >= MAX_WAIT_FRAMES) {
        reveal();
        return;
      }
      raf = requestAnimationFrame(poll);
    };

    raf = requestAnimationFrame(poll);

    const timeout = setTimeout(function checkReveal() {
      if (isReadyRef.current) return;
      const layout = layoutStateRef.current;
      const canRevealFromTimeout = layout === null;
      if (contentReadyRef.current && canRevealFromTimeout && isContainerAtBottom(el, sentinelRef.current)) {
        reveal();
      } else {
        setTimeout(checkReveal, 200);
      }
    }, SETTLE_TIMEOUT_MS);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [ref, resetKey, scrollSentinelToEnd, syncFollowState]);

  // Post-reveal correction
  useLayoutEffect(() => {
    if (!isReady || !pinnedRef.current) return;
    scrollSentinelToEnd();
    const el = ref.current;
    if (el) prevScrollHeightRef.current = el.scrollHeight;
  }, [isReady, ref, scrollSentinelToEnd]);

  // ── Active phase: auto-scroll on content changes ────────────────────
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let contentChangeRaf = 0;
    let mutationSettleRaf = 0;

    const syncHeight = () => {
      prevScrollHeightRef.current = el.scrollHeight;
    };

    const onContentChange = () => {
      if (phaseRef.current !== "active") return;
      const oldSH = prevScrollHeightRef.current;
      const newSH = el.scrollHeight;
      if (newSH === oldSH) return;
      const delta = newSH - oldSH;
      const activeElement = document.activeElement;
      const userInteractingWithContent =
        activeElement instanceof HTMLElement &&
        activeElement !== el &&
        el.contains(activeElement);

      if (userInteractingWithContent) {
        pinnedRef.current = false;
        syncFollowState();
      }

      if (pinnedRef.current && delta !== 0) {
        guardedScroll(el, el.scrollHeight, guardRef);
        syncHeight();
        return;
      }
      syncHeight();
    };

    const queueContentChange = () => {
      if (contentChangeRaf !== 0) return;
      contentChangeRaf = requestAnimationFrame(() => {
        contentChangeRaf = 0;
        onContentChange();
      });
    };

    const queueMutationContentChange = () => {
      if (mutationSettleRaf !== 0) return;
      mutationSettleRaf = requestAnimationFrame(() => {
        mutationSettleRaf = 0;
        queueContentChange();
      });
    };

    let lastWidth = el.clientWidth;
    let lastHeight = el.clientHeight;
    const containerObs = new ResizeObserver(() => {
      if (phaseRef.current !== "active") return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const widthChanged = w !== lastWidth;
      const heightChanged = h !== lastHeight;

      if (!widthChanged && !heightChanged) return;

      lastWidth = w;
      lastHeight = h;

      if (heightChanged) {
        if (pinnedRef.current) {
          guardedScroll(el, el.scrollHeight, guardRef);
        }
        syncHeight();
      }

      if (widthChanged) {
        queueContentChange();
      }
    });
    containerObs.observe(el);

    const contentObs =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(queueContentChange);
    const observedChildren = new Set<Element>();
    const syncObservedChildren = () => {
      if (!contentObs) return;
      const children = new Set(Array.from(el.children));
      for (const child of observedChildren) {
        if (!children.has(child)) {
          contentObs.unobserve(child);
          observedChildren.delete(child);
        }
      }
      for (const child of children) {
        if (!observedChildren.has(child)) {
          observedChildren.add(child);
          contentObs.observe(child);
        }
      }
    };

    const mutationObs = new MutationObserver(() => {
      syncObservedChildren();
      queueMutationContentChange();
    });
    mutationObs.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    syncObservedChildren();

    syncHeight();

    return () => {
      if (mutationSettleRaf !== 0) {
        cancelAnimationFrame(mutationSettleRaf);
      }
      if (contentChangeRaf !== 0) {
        cancelAnimationFrame(contentChangeRaf);
      }
      mutationObs.disconnect();
      containerObs.disconnect();
      contentObs?.disconnect();
    };
  }, [ref, sentinelRef, resetKey, syncFollowState]);

  // ── Scroll handler ──────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    if (guardRef.current) return;
    const el = ref.current;
    if (!el) return;

    const sentinel = sentinelRef.current;
    const delta = el.scrollTop - lastScrollTopRef.current;

    if (phaseRef.current === "settling") {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
      if (!atBottom && delta <= -USER_SCROLL_ESCAPE_PX) {
        phaseRef.current = "active";
        pinnedRef.current = false;
        syncFollowState();
        if (!isReadyRef.current) {
          setIsReady(true);
          isReadyRef.current = true;
        }
      }
      lastScrollTopRef.current = el.scrollTop;
      return;
    }

    // "At bottom" means sentinel is within the visible area
    if (sentinel) {
      const nextPinned = !isSentinelBelowViewport(sentinel, el);
      if (pinnedRef.current !== nextPinned) {
        pinnedRef.current = nextPinned;
        syncFollowState();
      }
    } else {
      const nextPinned =
        el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
      if (pinnedRef.current !== nextPinned) {
        pinnedRef.current = nextPinned;
        syncFollowState();
      }
    }
    lastScrollTopRef.current = el.scrollTop;
  }, [ref, sentinelRef, syncFollowState]);

  // ── Imperative methods ─────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    syncFollowState();
    scrollSentinelToEnd();
  }, [scrollSentinelToEnd, syncFollowState]);

  const scrollToBottomIfPinned = useCallback(() => {
    if (!pinnedRef.current) return;
    scrollSentinelToEnd();
  }, [scrollSentinelToEnd]);

  return {
    handleScroll,
    scrollToBottom,
    scrollToBottomIfPinned,
    isReady,
    isAutoFollowing,
  };
}
