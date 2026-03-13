import { useEffect, useRef, useCallback } from "react";

export function useAutoScroll(
  ref: React.RefObject<HTMLElement | null>,
  deps: unknown[],
): { handleScroll: () => void } {
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, [ref]);

  return { handleScroll };
}
