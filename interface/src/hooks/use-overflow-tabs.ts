import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef, type RefObject } from "react";

interface OverflowResult<T> {
  visibleItems: readonly T[];
  overflowItems: readonly T[];
}

// When the container width is sitting right on the boundary where one
// extra tab would just barely fit, integer-floor measurement jitter
// (sub-pixel clientWidth / offsetWidth changes, painting rounding,
// scrollbar reserve differences) can flip `maxVisible` back and forth
// every resize-observer tick. We require this many extra pixels of
// headroom *beyond* the raw threshold before we move an item from
// overflow back into the visible set. Going the other direction –
// hiding a tab because it no longer fits – is always immediate.
const EXPAND_HYSTERESIS_PX = 4;

/**
 * Dynamically splits `items` into visible / overflow buckets based on how
 * many icon-only buttons fit inside `containerRef` (the outer flex row that
 * holds both the tab bar and the more-button).
 *
 * `alwaysShowMore` – when true the more-button slot is always reserved
 * (useful when the button has permanent actions like Edit / Delete).
 */
export function useOverflowTabs<T>(
  containerRef: RefObject<HTMLElement | null>,
  items: readonly T[],
  alwaysShowMore = false,
): OverflowResult<T> {
  const [maxVisible, setMaxVisible] = useState(items.length);
  // Latest-committed maxVisible, read during measurement so hysteresis
  // can compare the newly-computed `n` against what we're currently
  // showing without relying on stale closure state.
  const maxVisibleRef = useRef(items.length);

  const applyMaxVisible = useCallback((next: number) => {
    setMaxVisible((prev) => {
      if (prev === next) return prev;
      maxVisibleRef.current = next;
      return next;
    });
  }, []);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container || items.length === 0) return;

    const tabBar = container.firstElementChild as HTMLElement | null;
    if (!tabBar) return;
    const btn = tabBar.querySelector<HTMLElement>(":scope > button");
    if (!btn) return;

    const btnW = btn.offsetWidth;
    if (btnW <= 0) return;

    const tabGap = parseFloat(getComputedStyle(tabBar).gap) || 0;
    const slot = btnW + tabGap;

    const cs = getComputedStyle(container);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const containerGap = parseFloat(cs.gap) || 0;
    const totalAvailable = container.clientWidth - padX;

    const moreSlot = btnW + containerGap;

    const computeN = (forTabs: number) =>
      Math.max(1, Math.floor((forTabs + tabGap) / slot));

    let n: number;
    if (alwaysShowMore) {
      n = computeN(totalAvailable - moreSlot);
    } else {
      const allW = items.length * btnW + (items.length - 1) * tabGap;
      if (allW <= totalAvailable) {
        n = items.length;
      } else {
        n = computeN(totalAvailable - moreSlot);
      }
    }
    n = Math.min(n, items.length);

    const current = maxVisibleRef.current;
    if (n > current) {
      // Expanding: require a little extra slack past the raw threshold
      // before bringing a previously-overflowed tab back in. Without
      // this, sub-pixel measurement jitter flips maxVisible by one
      // every resize tick, which is exactly what produces the
      // "duplicate icon blinking next to the More button" flicker at
      // the Debug sidekick width.
      const thresholdForN = n * btnW + (n - 1) * tabGap;
      const budget = alwaysShowMore ? totalAvailable - moreSlot : totalAvailable;
      if (budget - thresholdForN < EXPAND_HYSTERESIS_PX) {
        n = current;
      }
    }

    applyMaxVisible(n);
  }, [containerRef, items.length, alwaysShowMore, applyMaxVisible]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [containerRef, measure]);

  const n = Math.min(maxVisible, items.length);
  return useMemo(
    () => ({ visibleItems: items.slice(0, n), overflowItems: items.slice(n) }),
    [items, n],
  );
}
