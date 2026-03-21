import { useEffect, useRef, useCallback } from "react";

/**
 * Auto-scrolls a container to the bottom whenever its content changes,
 * but only if the user is already near the bottom. Uses MutationObserver
 * to detect DOM changes and ResizeObserver to compensate for content
 * reflow when the container width changes (e.g. lane resize).
 */
export function useAutoScroll(
  ref: React.RefObject<HTMLElement | null>,
  resetKey?: unknown,
): { handleScroll: () => void } {
  const autoScrollRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  // Guards against programmatic scrollTop assignments firing the onScroll
  // handler and falsely disabling auto-scroll when new content has already
  // increased scrollHeight between the assignment and the scroll event.
  const programmaticScrollRef = useRef(false);

  useEffect(() => {
    autoScrollRef.current = true;
  }, [resetKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const syncHeight = () => {
      prevScrollHeightRef.current = el.scrollHeight;
    };

    const doProgrammaticScroll = (target: number) => {
      programmaticScrollRef.current = true;
      el.scrollTop = target;
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    };

    const scrollIfNeeded = () => {
      if (autoScrollRef.current && el) {
        doProgrammaticScroll(el.scrollHeight);
      }
    };

    let pendingRaf: number | null = null;

    const mutationObs = new MutationObserver(() => {
      if (pendingRaf !== null) return;
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = null;
        scrollIfNeeded();
        syncHeight();
      });
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
        doProgrammaticScroll(newSH);
      } else if (oldSH > 0 && newSH !== oldSH) {
        doProgrammaticScroll(Math.round(el.scrollTop * (newSH / oldSH)));
      }

      syncHeight();
    });
    resizeObs.observe(el);

    scrollIfNeeded();
    syncHeight();

    return () => {
      if (pendingRaf !== null) cancelAnimationFrame(pendingRaf);
      mutationObs.disconnect();
      resizeObs.disconnect();
    };
  }, [ref, resetKey]);

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, [ref]);

  return { handleScroll };
}
