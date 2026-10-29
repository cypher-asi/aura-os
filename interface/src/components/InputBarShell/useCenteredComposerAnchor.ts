import { useLayoutEffect, type RefObject } from "react";

/** Keep the initial typing target steady when centered composer notices resize. */
export function useCenteredComposerAnchor(
  rootRef: RefObject<HTMLDivElement | null>,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  enabled: boolean,
) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const textarea = textareaRef.current;
    if (!enabled || !root || !textarea || typeof ResizeObserver === "undefined") return;
    let initialBias: number | undefined;
    let previousOffset: number | undefined;
    const measure = () => {
      const rootRect = root.getBoundingClientRect();
      const inputRect = textarea.getBoundingClientRect();
      if (rootRect.height <= 0 || inputRect.height <= 0 || inputRect.width <= 0) return;
      const inputCenter = inputRect.top + inputRect.height / 2;
      initialBias ??= inputCenter - (rootRect.top + rootRect.height / 2);
      const offset = Math.round((rootRect.bottom - inputCenter + initialBias) * 100) / 100;
      if (offset === previousOffset) return;
      root.style.setProperty("--centered-composer-offset", `${offset}px`);
      previousOffset = offset;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(textarea);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--centered-composer-offset");
    };
  }, [enabled, rootRef, textareaRef]);
}
