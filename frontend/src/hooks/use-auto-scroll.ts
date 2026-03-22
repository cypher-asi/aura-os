import { useEffect, useRef, useCallback } from "react";

const BOTTOM_THRESHOLD_PX = 40;
const SETTLING_TIMEOUT_MS = 1500;
const USER_SCROLL_ESCAPE_PX = 80;

/**
 * Sets `el.scrollTop` to `target` and guards the resulting scroll event so
 * it isn't misread as a user-initiated scroll (which would disable
 * auto-scroll when new content increases scrollHeight between the
 * assignment and the event).
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
 * Auto-scrolls a container to the bottom whenever its content changes,
 * but only if the user is already near the bottom. Uses MutationObserver
 * to detect DOM changes and ResizeObserver to compensate for content
 * reflow when the container width changes (e.g. lane resize).
 */
export function useAutoScroll(
  ref: React.RefObject<HTMLElement | null>,
  resetKey?: unknown,
): { handleScroll: () => void; scrollToBottom: () => void } {
  const autoScrollRef = useRef(true);
  const settlingRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevScrollHeightRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const pendingTargetRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    autoScrollRef.current = true;
    settlingRef.current = true;
    lastScrollTopRef.current = el.scrollTop;
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = setTimeout(() => {
      settlingRef.current = false;
      settleTimerRef.current = null;
    }, SETTLING_TIMEOUT_MS);

    const syncHeight = () => {
      prevScrollHeightRef.current = el.scrollHeight;
    };

    const scheduleScroll = (target: number) => {
      pendingTargetRef.current = target;
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const nextTarget = pendingTargetRef.current;
        pendingTargetRef.current = null;
        if (nextTarget == null) return;
        if (autoScrollRef.current) {
          guardedScroll(el, nextTarget, programmaticScrollRef);
        }
        syncHeight();
      });
    };

    const scrollIfNeeded = () => {
      scheduleScroll(el.scrollHeight);
    };

    const mutationObs = new MutationObserver(() => {
      const oldSH = prevScrollHeightRef.current;
      const newSH = el.scrollHeight;
      if (newSH === oldSH) return;
      if (autoScrollRef.current && newSH > oldSH) {
        scheduleScroll(newSH);
        return;
      }
      syncHeight();
    });
    mutationObs.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    let lastWidth = el.clientWidth;
    const resizeObs = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;

      const oldSH = prevScrollHeightRef.current;
      const newSH = el.scrollHeight;

      if (autoScrollRef.current) {
        guardedScroll(el, newSH, programmaticScrollRef);
      } else if (oldSH > 0 && newSH !== oldSH) {
        guardedScroll(
          el,
          Math.round(el.scrollTop * (newSH / oldSH)),
          programmaticScrollRef,
        );
      }

      syncHeight();
    });
    resizeObs.observe(el);

    scrollIfNeeded();
    syncHeight();

    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      mutationObs.disconnect();
      resizeObs.disconnect();
    };
  }, [ref, resetKey]);

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
    const delta = el.scrollTop - lastScrollTopRef.current;
    if (settlingRef.current) {
      // During startup/conversation switch, ignore virtualizer settling jitter.
      // But if the user scrolls up intentionally, exit settling and respect it.
      if (!atBottom && delta <= -USER_SCROLL_ESCAPE_PX) {
        settlingRef.current = false;
        autoScrollRef.current = false;
      } else if (atBottom) {
        settlingRef.current = false;
      }
      lastScrollTopRef.current = el.scrollTop;
      return;
    }
    autoScrollRef.current = atBottom;
    lastScrollTopRef.current = el.scrollTop;
  }, [ref]);

  const scrollToBottom = useCallback(() => {
    autoScrollRef.current = true;
    const el = ref.current;
    if (el) {
      guardedScroll(el, el.scrollHeight, programmaticScrollRef);
    }
  }, [ref]);

  return { handleScroll, scrollToBottom };
}
