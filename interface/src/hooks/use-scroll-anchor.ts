import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";

const BOTTOM_THRESHOLD_PX = 40;
const USER_SCROLL_ESCAPE_PX = 80;
const STABLE_FRAMES_REQUIRED = 3;
const SETTLE_TIMEOUT_MS = 2000;
const MAX_WAIT_FRAMES = 10;

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
 * Manages scroll-to-bottom for a chat message container backed by a
 * virtualised list with dynamic row heights.
 *
 * Operates in two phases:
 *
 *   **Settling** – entered on mount / `resetKey` change. Content is
 *   hidden (`isReady = false`). A tight RAF loop polls `scrollHeight`
 *   until the virtualiser finishes its measure-render cascade, then
 *   scrolls to the bottom and reveals.
 *
 *   **Active** – content is visible. MutationObserver and
 *   ResizeObservers keep the view pinned to the bottom while new
 *   content streams in, unless the user scrolls up.
 */
export function useScrollAnchor(
  ref: React.RefObject<HTMLElement | null>,
  options: {
    resetKey?: unknown;
    /** Whether history has resolved (ready or error). */
    contentReady: boolean;
  },
): {
  handleScroll: () => void;
  scrollToBottom: () => void;
  scrollToBottomIfPinned: () => void;
  isReady: boolean;
} {
  const { resetKey, contentReady } = options;

  const pinnedRef = useRef(true);
  const phaseRef = useRef<"settling" | "active">("settling");
  const guardRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const lastScrollTopRef = useRef(0);

  const [isReady, setIsReady] = useState(false);
  const isReadyRef = useRef(false);

  const contentReadyRef = useRef(contentReady);
  useLayoutEffect(() => { contentReadyRef.current = contentReady; }, [contentReady]);

  // ── Settling phase ──────────────────────────────────────────────────
  // Polls scrollHeight via RAF until the virtualiser's measurement
  // cascade has stabilised, then scrolls to bottom and reveals.

  useEffect(() => {
    phaseRef.current = "settling";
    pinnedRef.current = true;
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
      guardedScroll(el, el.scrollHeight, guardRef);
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
        el.scrollTop = el.scrollHeight;
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
  }, [ref, resetKey]);

  // Post-reveal correction: removing opacity:0 can trigger virtualiser
  // recalculations that change scrollHeight. useLayoutEffect runs after
  // React commits but before the browser paints, so the correction is
  // invisible to the user.
  useLayoutEffect(() => {
    if (!isReady || !pinnedRef.current) return;
    const el = ref.current;
    if (el) {
      guardedScroll(el, el.scrollHeight, guardRef);
      prevScrollHeightRef.current = el.scrollHeight;
    }
  }, [isReady, ref]);

  // ── Active phase: auto-scroll on content changes ────────────────────
  // MutationObserver catches DOM additions / streaming text. Child
  // ResizeObserver catches virtualiser measurement corrections (inline
  // style changes that don't alter DOM structure). Container
  // ResizeObserver handles width changes (lane resize).
  //
  // Scrolls are applied synchronously inside observer callbacks so the
  // correction lands before the browser paints, eliminating the visible
  // one-frame snap that a RAF-deferred approach would produce during
  // large height jumps (e.g. a thinking block appearing).

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
      if (pinnedRef.current) {
        guardedScroll(el, el.scrollHeight, guardRef);
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
        guardedScroll(el, newSH, guardRef);
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
  }, [ref, resetKey]);

  // ── Scroll handler ──────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    if (guardRef.current) return;
    const el = ref.current;
    if (!el) return;

    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
    const delta = el.scrollTop - lastScrollTopRef.current;

    if (phaseRef.current === "settling") {
      // During settling, only a strong intentional scroll up escapes.
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

    pinnedRef.current = atBottom;
    lastScrollTopRef.current = el.scrollTop;
  }, [ref]);

  // ── Imperative scroll-to-bottom ─────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    const el = ref.current;
    if (el) {
      guardedScroll(el, el.scrollHeight, guardRef);
    }
  }, [ref]);

  const scrollToBottomIfPinned = useCallback(() => {
    if (!pinnedRef.current) return;
    const el = ref.current;
    if (el) {
      guardedScroll(el, el.scrollHeight, guardRef);
    }
  }, [ref]);

  return { handleScroll, scrollToBottom, scrollToBottomIfPinned, isReady };
}
