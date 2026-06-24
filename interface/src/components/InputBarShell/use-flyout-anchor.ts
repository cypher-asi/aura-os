import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

export interface FlyoutPosition {
  top: number;
  left?: number;
  right?: number;
}

export interface UseFlyoutAnchorOptions {
  /** Flyout width, used to decide whether it opens to the right or left. */
  flyoutWidth: number;
  /**
   * Approximate rendered flyout height, used to clamp `top` so the flyout
   * never spills past the bottom of the viewport when its anchor row sits
   * low on screen.
   */
  estimatedHeight?: number;
  /** Delay before the flyout closes after the pointer leaves. */
  closeDelayMs?: number;
  /** When false, {@link openFlyout} is a no-op (e.g. disabled rows). */
  enabled?: boolean;
  /** Runs right before this anchor opens (e.g. close a sibling flyout). */
  onBeforeOpen?: () => void;
  /** Runs when this anchor closes (e.g. release a shared slot). */
  onClose?: () => void;
}

export interface FlyoutAnchor {
  flyoutPos: FlyoutPosition | null;
  flyoutStyle: CSSProperties | undefined;
  openFlyout: () => void;
  scheduleClose: () => void;
  clearCloseTimer: () => void;
  immediateClose: () => void;
}

const DEFAULT_CLOSE_DELAY_MS = 120;
const DEFAULT_ESTIMATED_HEIGHT = 160;
const VIEWPORT_MARGIN = 8;

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Shared anchoring logic for the model picker's hover flyouts (the
 * per-model effort/detail submenu in {@link import("./ModelMenuRow").ModelMenuRow}
 * and the AURA Council count submenu in
 * {@link import("./CouncilCountRow").CouncilCountRow}).
 *
 * Both flyouts are rendered through a `document.body` portal with fixed
 * coordinates derived from the anchor row's bounding rect. Capturing that
 * rect only once (the previous behaviour) left the flyout pinned to a
 * stale point whenever the menu's layout shifted after open — an inner
 * scroll, the "Combine results" section toggling, or sub-pixel/scrollbar
 * differences across browsers (notably Edge) — so it could float away
 * from its row. This hook keeps the position live: it recomputes on
 * scroll (capture phase, so it also catches the scrolling `.modelMenu`
 * container), on resize, and whenever the surrounding scroll container
 * changes size (the `ResizeObserver` also fires once on observe, which
 * settles the position right after the menu's first paint).
 */
export function useFlyoutAnchor(
  rowRef: RefObject<HTMLElement | null>,
  options: UseFlyoutAnchorOptions,
): FlyoutAnchor {
  const {
    flyoutWidth,
    estimatedHeight = DEFAULT_ESTIMATED_HEIGHT,
    closeDelayMs = DEFAULT_CLOSE_DELAY_MS,
    enabled = true,
    onBeforeOpen,
    onClose,
  } = options;

  const [flyoutPos, setFlyoutPos] = useState<FlyoutPosition | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous open/closed intent, flipped the instant `openFlyout` /
  // `immediateClose` run. `flyoutPos` (and therefore `isOpen`) only
  // settles on the next commit, and the scroll listener that recomputes
  // position is torn down in an async effect — so during a scroll event
  // that also re-homes the pointer onto a new row, a just-closed row's
  // reflow could fire and resurrect its flyout (re-setting `flyoutPos`),
  // leaving multiple submenus stacked. This ref lets `reflow` bail
  // synchronously when its flyout is no longer meant to be open.
  const openRef = useRef(false);

  // Keep callbacks/flags reachable from stable handlers without widening
  // their dependency lists (and re-subscribing the reflow effect). Updated
  // in an effect (never during render) to satisfy `react-hooks/refs`; the
  // consumers below are all event/timer driven, so they fire after commit
  // and always read the latest value.
  const onBeforeOpenRef = useRef(onBeforeOpen);
  const onCloseRef = useRef(onClose);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    onBeforeOpenRef.current = onBeforeOpen;
    onCloseRef.current = onClose;
    enabledRef.current = enabled;
  });

  const computePos = useCallback(
    (rect: DOMRect): FlyoutPosition => {
      const spaceRight = window.innerWidth - rect.right;
      const maxTop = Math.max(
        VIEWPORT_MARGIN,
        window.innerHeight - estimatedHeight - VIEWPORT_MARGIN,
      );
      const top = Math.min(Math.max(VIEWPORT_MARGIN, rect.top), maxTop);
      return spaceRight >= flyoutWidth + VIEWPORT_MARGIN
        ? { top, left: rect.right + 2 }
        : { top, right: window.innerWidth - rect.left + 2 };
    },
    [flyoutWidth, estimatedHeight],
  );

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const immediateClose = useCallback(() => {
    clearCloseTimer();
    openRef.current = false;
    setFlyoutPos(null);
    onCloseRef.current?.();
  }, [clearCloseTimer]);

  // Stable identity for the close handler so external coordinators (the
  // module-level single-open slot in `ModelMenuRow`) and the unmount
  // cleanup can call the latest implementation without re-subscribing.
  const immediateCloseRef = useRef(immediateClose);
  useEffect(() => {
    immediateCloseRef.current = immediateClose;
  });

  const openFlyout = useCallback(() => {
    if (!enabledRef.current) return;
    clearCloseTimer();
    onBeforeOpenRef.current?.();
    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    openRef.current = true;
    setFlyoutPos(computePos(rect));
  }, [clearCloseTimer, computePos, rowRef]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(
      () => immediateCloseRef.current(),
      closeDelayMs,
    );
  }, [clearCloseTimer, closeDelayMs]);

  // Close on unmount so a portal can't outlive its row.
  useEffect(() => () => immediateCloseRef.current(), []);

  const isOpen = flyoutPos !== null;
  useEffect(() => {
    if (!isOpen) return;
    const reflow = () => {
      // A scroll that re-homes the pointer onto another row can fire this
      // listener after our flyout was already closed (its teardown effect
      // hasn't run yet); without this guard that stale reflow would
      // re-open the closed flyout, stacking multiple submenus.
      if (!openRef.current) return;
      const rect = rowRef.current?.getBoundingClientRect();
      if (rect) setFlyoutPos(computePos(rect));
    };
    window.addEventListener("scroll", reflow, true);
    window.addEventListener("resize", reflow);
    let observer: ResizeObserver | null = null;
    const scrollParent = findScrollParent(rowRef.current);
    if (scrollParent && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(reflow);
      observer.observe(scrollParent);
    }
    return () => {
      window.removeEventListener("scroll", reflow, true);
      window.removeEventListener("resize", reflow);
      observer?.disconnect();
    };
  }, [isOpen, computePos, rowRef]);

  const flyoutStyle: CSSProperties | undefined = flyoutPos
    ? {
        position: "fixed",
        top: flyoutPos.top,
        ...(flyoutPos.left != null ? { left: flyoutPos.left } : {}),
        ...(flyoutPos.right != null ? { right: flyoutPos.right } : {}),
        zIndex: 10001,
      }
    : undefined;

  return {
    flyoutPos,
    flyoutStyle,
    openFlyout,
    scheduleClose,
    clearCloseTimer,
    immediateClose,
  };
}
