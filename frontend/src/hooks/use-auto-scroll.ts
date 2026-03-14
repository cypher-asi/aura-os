import { useEffect, useRef, useCallback } from "react";

/**
 * Auto-scrolls a container to the bottom whenever its content changes,
 * but only if the user is already near the bottom. Uses MutationObserver
 * to detect DOM changes rather than relying on specific state dependencies.
 */
export function useAutoScroll(
  ref: React.RefObject<HTMLElement | null>,
  resetKey?: unknown,
): { handleScroll: () => void } {
  const autoScrollRef = useRef(true);

  useEffect(() => {
    autoScrollRef.current = true;
  }, [resetKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const scrollIfNeeded = () => {
      if (autoScrollRef.current && el) {
        el.scrollTop = el.scrollHeight;
      }
    };

    const observer = new MutationObserver(scrollIfNeeded);
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    scrollIfNeeded();

    return () => observer.disconnect();
  }, [ref, resetKey]);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, [ref]);

  return { handleScroll };
}
