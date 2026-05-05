import { useEffect } from "react";

interface UseImageScrollPinOptions {
  isAutoFollowing: boolean;
  /** Optional initial-reveal window during which we re-pin even if the
   * user is technically not auto-following yet (the cold-load reveal
   * runs a forced bottom anchor and we want late image decode to land
   * inside it). */
  initialRevealUntil?: number;
}

/**
 * Re-pins a scroll container to the bottom whenever a descendant
 * `<img>` finishes loading, while the user is following the tail.
 *
 * This complements `useScrollAnchorV2`, which only re-anchors on
 * React-tracked dependency changes. Late image decode (generated
 * images, historical attachments) grows the container after the
 * initial pin and is not a tracked dep, so without this hook the
 * viewport drifts above the new image.
 *
 * Uses a capturing `load` listener on the scroll element so it
 * receives load events from any nested `<img>`.
 */
export function useImageScrollPin(
  scrollRef: React.RefObject<HTMLElement | null>,
  { isAutoFollowing, initialRevealUntil }: UseImageScrollPinOptions,
): void {
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onLoad = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      const withinReveal =
        initialRevealUntil !== undefined && Date.now() < initialRevealUntil;
      if (!isAutoFollowing && !withinReveal) return;
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distFromBottom <= 1) return;
      el.scrollTop = el.scrollHeight;
    };

    el.addEventListener("load", onLoad, true);
    return () => {
      el.removeEventListener("load", onLoad, true);
    };
  }, [scrollRef, isAutoFollowing, initialRevealUntil]);
}
