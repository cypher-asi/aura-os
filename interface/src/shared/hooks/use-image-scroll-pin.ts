import { useEffect } from "react";

interface UseImageScrollPinOptions {
  isAutoFollowing: boolean;
  /** Optional UNIX-ms deadline; while now < deadline, we still re-pin
   * even if the user is technically not auto-following yet. Used by the
   * cold-load reveal so late-decoding images keep the viewport
   * anchored while the initial reveal animation runs. */
  initialRevealUntil?: number;
}

/**
 * Re-pins a scroll container to the bottom whenever its content grows,
 * while the user is following the tail. Complements
 * `useScrollAnchorV2`, which only re-anchors on React-tracked
 * dependency changes.
 *
 * Driven by a `ResizeObserver` on the inner content wrapper rather than
 * a capturing `load` listener, so it catches every layout-shifting
 * source the chat actually cares about — image decode (the original
 * motivation), late font load, dynamic tool-row expansion, gallery
 * close, etc. — without depending on `load` event propagation rules
 * that vary by browser when bubbles is `false`.
 *
 * The observer targets the scroll container's first element child
 * (the message-content wrapper). All chat content lives inside that
 * wrapper, so its `contentBoxSize` height reflects the total layout
 * size of the transcript.
 */
export function useImageScrollPin(
  scrollRef: React.RefObject<HTMLElement | null>,
  { isAutoFollowing, initialRevealUntil }: UseImageScrollPinOptions,
): void {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;

    const inner = el.firstElementChild as HTMLElement | null;
    if (!inner) return;

    const repinIfNeeded = (): void => {
      const withinReveal =
        initialRevealUntil !== undefined && Date.now() < initialRevealUntil;
      if (!isAutoFollowing && !withinReveal) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      // <= 1 covers sub-pixel rounding on high-DPI displays where
      // scrollHeight - scrollTop - clientHeight oscillates between
      // 0 and 0.5 even when visually pinned.
      if (distFromBottom <= 1) return;
      el.scrollTop = el.scrollHeight;
    };

    const observer = new ResizeObserver(() => {
      repinIfNeeded();
    });
    observer.observe(inner);

    // Belt-and-suspenders: also catch native `<img>` `load` events via
    // the capture phase. ResizeObserver fires on the next layout pass
    // after the image decodes, but in some WebKit/Chromium WebView
    // builds we've seen it coalesce with subsequent observations and
    // miss the very first decode of a freshly-mounted image. The
    // direct load listener pins immediately the moment the image
    // decodes, before layout flushes.
    const onLoad = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      repinIfNeeded();
    };
    el.addEventListener("load", onLoad, true);

    return () => {
      observer.disconnect();
      el.removeEventListener("load", onLoad, true);
    };
  }, [scrollRef, isAutoFollowing, initialRevealUntil]);
}
