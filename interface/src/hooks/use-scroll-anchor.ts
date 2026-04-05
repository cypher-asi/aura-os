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

function guardedScrollIntoView(
  target: HTMLElement,
  options: ScrollIntoViewOptions,
  guardRef: React.MutableRefObject<boolean>,
) {
  guardRef.current = true;
  target.scrollIntoView(options);
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

/**
 * Manages scroll behaviour for a chat message container backed by a
 * virtualised list with dynamic row heights. Uses a sentinel element
 * placed at the end of real content (before any spacer) as the
 * canonical "bottom of content" reference.
 *
 * Operates in two phases:
 *
 *   **Settling** – entered on mount / `resetKey` change. Content is
 *   hidden (`isReady = false`). A tight RAF loop polls `scrollHeight`
 *   until the virtualiser finishes its measure-render cascade, then
 *   scrolls the sentinel to the bottom of the viewport and reveals.
 *
 *   **Active** – content is visible. MutationObserver and
 *   ResizeObservers keep the sentinel pinned to the viewport bottom
 *   while new content streams in, unless the user scrolls up or the
 *   view is in "hold" mode (user message at top).
 */
export function useScrollAnchor(
  ref: React.RefObject<HTMLElement | null>,
  sentinelRef: React.RefObject<HTMLElement | null>,
  options: {
    resetKey?: unknown;
    contentReady: boolean;
  },
): {
  handleScroll: () => void;
  scrollToBottom: () => void;
  scrollToBottomIfPinned: () => void;
  scrollToTop: (target: HTMLElement) => void;
  holdPosition: () => void;
  isReady: boolean;
} {
  const { resetKey, contentReady } = options;

  const pinnedRef = useRef(true);
  const holdScrollRef = useRef(false);
  const phaseRef = useRef<"settling" | "active">("settling");
  const guardRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const lastScrollTopRef = useRef(0);

  const [isReady, setIsReady] = useState(false);
  const isReadyRef = useRef(false);

  const contentReadyRef = useRef(contentReady);
  useLayoutEffect(() => { contentReadyRef.current = contentReady; }, [contentReady]);

  /** Scroll sentinel to the bottom of the visible area (above input overlay). */
  const scrollSentinelToEnd = useCallback(() => {
    const sentinel = sentinelRef.current;
    if (sentinel) {
      guardedScrollIntoView(sentinel, { block: "end", behavior: "instant" }, guardRef);
    } else {
      const el = ref.current;
      if (el) guardedScroll(el, el.scrollHeight, guardRef);
    }
  }, [ref, sentinelRef]);

  // ── Settling phase ──────────────────────────────────────────────────
  useEffect(() => {
    phaseRef.current = "settling";
    pinnedRef.current = true;
    holdScrollRef.current = false;
    setIsReady(false);
    isReadyRef.current = false;

    const el = ref.current;
    if (!el) return;

    lastScrollTopRef.current = el.scrollTop;

    let prevHeight = el.scrollHeight;
    let stableFrames = 0;
    let heightChanged = false;
    let waitingFrames = 0;
    let raf = 0;

    const reveal = () => {
      if (isReadyRef.current) return;
      scrollSentinelToEnd();
      prevScrollHeightRef.current = el.scrollHeight;
      phaseRef.current = "active";
      setIsReady(true);
      isReadyRef.current = true;
    };

    const poll = () => {
      if (isReadyRef.current) return;

      if (!contentReadyRef.current) {
        raf = requestAnimationFrame(poll);
        return;
      }

      const h = el.scrollHeight;
      if (h !== prevHeight) {
        heightChanged = true;
        stableFrames = 0;
        prevHeight = h;
        scrollSentinelToEnd();
      } else if (heightChanged) {
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

    const timeout = setTimeout(() => {
      if (!isReadyRef.current) reveal();
    }, SETTLE_TIMEOUT_MS);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [ref, resetKey, scrollSentinelToEnd]);

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

    const syncHeight = () => {
      prevScrollHeightRef.current = el.scrollHeight;
    };

    const onContentChange = () => {
      if (phaseRef.current !== "active") return;
      const newSH = el.scrollHeight;
      if (newSH === prevScrollHeightRef.current) return;

      if (holdScrollRef.current) {
        const sentinel = sentinelRef.current;
        if (sentinel && isSentinelBelowViewport(sentinel, el)) {
          holdScrollRef.current = false;
          pinnedRef.current = true;
          guardedScrollIntoView(sentinel, { block: "end", behavior: "instant" }, guardRef);
        }
        syncHeight();
        return;
      }

      if (pinnedRef.current) {
        const sentinel = sentinelRef.current;
        if (sentinel) {
          guardedScrollIntoView(sentinel, { block: "end", behavior: "instant" }, guardRef);
        } else {
          guardedScroll(el, el.scrollHeight, guardRef);
        }
        syncHeight();
        return;
      }
      syncHeight();
    };

    const mutationObs = new MutationObserver(onContentChange);
    mutationObs.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    let lastWidth = el.clientWidth;
    const containerObs = new ResizeObserver(() => {
      if (phaseRef.current !== "active") return;
      const w = el.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;

      const oldSH = prevScrollHeightRef.current;
      const newSH = el.scrollHeight;

      if (pinnedRef.current) {
        const sentinel = sentinelRef.current;
        if (sentinel) {
          guardedScrollIntoView(sentinel, { block: "end", behavior: "instant" }, guardRef);
        } else {
          guardedScroll(el, newSH, guardRef);
        }
      } else if (oldSH > 0 && newSH !== oldSH) {
        guardedScroll(
          el,
          Math.round(el.scrollTop * (newSH / oldSH)),
          guardRef,
        );
      }
      syncHeight();
    });
    containerObs.observe(el);

    const contentObs = new ResizeObserver(onContentChange);
    for (const child of Array.from(el.children)) {
      contentObs.observe(child);
    }

    syncHeight();

    return () => {
      mutationObs.disconnect();
      contentObs.disconnect();
      containerObs.disconnect();
    };
  }, [ref, sentinelRef, resetKey]);

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
        if (!isReadyRef.current) {
          setIsReady(true);
          isReadyRef.current = true;
        }
      }
      lastScrollTopRef.current = el.scrollTop;
      return;
    }

    if (holdScrollRef.current) {
      holdScrollRef.current = false;
    }

    // "At bottom" means sentinel is within the visible area
    if (sentinel) {
      pinnedRef.current = !isSentinelBelowViewport(sentinel, el);
    } else {
      pinnedRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
    }
    lastScrollTopRef.current = el.scrollTop;
  }, [ref, sentinelRef]);

  // ── Imperative methods ─────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    holdScrollRef.current = false;
    scrollSentinelToEnd();
  }, [scrollSentinelToEnd]);

  const scrollToBottomIfPinned = useCallback(() => {
    if (!pinnedRef.current) return;
    scrollSentinelToEnd();
  }, [scrollSentinelToEnd]);

  /** Scroll a target element to the top of the viewport. */
  const scrollToTop = useCallback((target: HTMLElement) => {
    guardedScrollIntoView(target, { block: "start", behavior: "instant" }, guardRef);
  }, []);

  /**
   * Freeze the current scroll position. Auto-scroll is suppressed until
   * the sentinel falls below the viewport, at which point normal pinned
   * auto-scroll resumes automatically.
   */
  const holdPosition = useCallback(() => {
    holdScrollRef.current = true;
    pinnedRef.current = false;
  }, []);

  return { handleScroll, scrollToBottom, scrollToBottomIfPinned, scrollToTop, holdPosition, isReady };
}
