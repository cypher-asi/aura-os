/*
 * Shared activity signal for the marketing pages' decorative WebGL/canvas
 * scenes. A scene should only burn GPU/CPU while it can actually be seen:
 * `observeSceneActivity` reports `true` only while the host element is in
 * (or near) the viewport AND the tab is visible, and `false` otherwise, so
 * every scene can start/stop its requestAnimationFrame loop from one
 * combined signal instead of wiring IntersectionObserver and
 * `visibilitychange` separately.
 */

export interface SceneActivityOptions {
  /**
   * Margin around the viewport within which the scene counts as visible,
   * so loops restart slightly before the element scrolls into view.
   * Defaults to `"160px"`.
   */
  rootMargin?: string;
}

/**
 * Watch `target` and invoke `onChange(active)` whenever the combined
 * "element is near the viewport AND the document is visible" state flips.
 * Fires once immediately with the initial state. Returns a disposer.
 *
 * In environments without `IntersectionObserver` (e.g. JSDOM) the element
 * is treated as always in view, preserving previous behavior.
 */
export function observeSceneActivity(
  target: Element,
  onChange: (active: boolean) => void,
  options: SceneActivityOptions = {},
): () => void {
  const hasIO = typeof IntersectionObserver !== "undefined";
  // Until the observer's first callback we assume out-of-view (when IO is
  // available) so a below-the-fold scene never runs a frame before it has
  // ever been near the viewport.
  let inView = !hasIO;
  let active: boolean | null = null;

  const update = (): void => {
    const next = inView && !document.hidden;
    if (next !== active) {
      active = next;
      onChange(next);
    }
  };

  const onVisibilityChange = (): void => update();
  document.addEventListener("visibilitychange", onVisibilityChange);

  let observer: IntersectionObserver | null = null;
  if (hasIO) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          inView = entry.isIntersecting;
        }
        update();
      },
      { rootMargin: options.rootMargin ?? "160px" },
    );
    observer.observe(target);
  }
  update();

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    observer?.disconnect();
  };
}

/** OS-level reduced-motion preference (safe in non-DOM environments). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
