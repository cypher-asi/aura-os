import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";

const BOTTOM_THRESHOLD_PX = 40;
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

/**
 * Manages scroll behaviour for a chat message container backed by a
 * virtualised list with dynamic row heights. Uses a sentinel element
 * placed at the end of real content (before any spacer) as the
 * canonical "bottom of content" reference.
 *
 * Keeps a chat message viewport pinned to the bottom while content is
 * streaming or remeasuring, unless the user scrolls away.
 */
export function useScrollAnchor(
  ref: React.RefObject<HTMLElement | null>,
  sentinelRef: React.RefObject<HTMLElement | null>,
  options: {
    resetKey?: unknown;
  },
): {
  handleScroll: () => void;
  scrollToBottom: () => void;
  scrollToBottomIfPinned: () => void;
  isAutoFollowing: boolean;
} {
  const { resetKey } = options;

  const pinnedRef = useRef(true);
  const guardRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const lastScrollTopRef = useRef(0);

  const [isAutoFollowing, setIsAutoFollowing] = useState(true);

  const syncFollowState = useCallback(() => {
    const next = pinnedRef.current;
    setIsAutoFollowing((prev) => (prev === next ? prev : next));
  }, []);

  /** Scroll sentinel to the bottom of the visible area (above input overlay). */
  const scrollSentinelToEnd = useCallback(() => {
    const el = ref.current;
    if (el) guardedScroll(el, el.scrollHeight, guardRef);
  }, [ref]);

  useLayoutEffect(() => {
    pinnedRef.current = true;
    syncFollowState();
    const el = ref.current;
    if (!el) {
      return;
    }
    scrollSentinelToEnd();
    prevScrollHeightRef.current = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  }, [ref, resetKey, scrollSentinelToEnd, syncFollowState]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let contentChangeRaf = 0;
    let mutationSettleRaf = 0;

    const syncHeight = () => {
      prevScrollHeightRef.current = el.scrollHeight;
    };

    const onContentChange = () => {
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
    const containerObs =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
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
    containerObs?.observe(el);

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
      containerObs?.disconnect();
      contentObs?.disconnect();
    };
  }, [ref, sentinelRef, resetKey, syncFollowState]);

  const handleScroll = useCallback(() => {
    if (guardRef.current) return;
    const el = ref.current;
    if (!el) return;

    const sentinel = sentinelRef.current;

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
    isAutoFollowing,
  };
}
