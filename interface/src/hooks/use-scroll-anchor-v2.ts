import { useLayoutEffect, useRef, useCallback, useState } from "react";

const BOTTOM_THRESHOLD_PX = 40;
const INPUT_OVERLAY_PX = 140;
const EXIT_FOLLOW_THRESHOLD_PX = BOTTOM_THRESHOLD_PX + INPUT_OVERLAY_PX + 48;
const ENTER_FOLLOW_THRESHOLD_PX = BOTTOM_THRESHOLD_PX + INPUT_OVERLAY_PX;

export interface AnchorInfo {
  messageId: string;
  offsetInViewport: number;
}

export interface UseScrollAnchorV2Return {
  handleScroll: () => void;
  scrollToBottom: () => void;
  scrollToBottomIfPinned: () => void;
  isAutoFollowing: boolean;
  captureAnchor: () => AnchorInfo | null;
  restoreAnchor: (anchor: AnchorInfo) => void;
  onContentHeightChange: (options?: { immediate?: boolean }) => void;
}

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

function findFirstVisibleMessage(
  container: HTMLElement,
): { id: string; el: HTMLElement } | null {
  const containerTop = container.getBoundingClientRect().top;
  const candidates = container.querySelectorAll<HTMLElement>(
    "[data-message-id]",
  );
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > containerTop) {
      const id = el.getAttribute("data-message-id");
      if (id) return { id, el };
    }
  }
  return null;
}

export function useScrollAnchorV2(
  ref: React.RefObject<HTMLElement | null>,
  options: { resetKey?: unknown },
): UseScrollAnchorV2Return {
  const { resetKey } = options;

  const pinnedRef = useRef(true);
  const guardRef = useRef(false);
  const currentAnchorRef = useRef<AnchorInfo | null>(null);
  const contentChangeRafRef = useRef(0);

  const [isAutoFollowing, setIsAutoFollowing] = useState(true);

  const syncFollowState = useCallback(() => {
    const next = pinnedRef.current;
    setIsAutoFollowing((prev) => (prev === next ? prev : next));
  }, []);

  const doScrollToBottom = useCallback(() => {
    const el = ref.current;
    if (el) guardedScroll(el, el.scrollHeight, guardRef);
  }, [ref]);

  useLayoutEffect(() => {
    pinnedRef.current = true;
    currentAnchorRef.current = null;
    if (contentChangeRafRef.current !== 0) {
      cancelAnimationFrame(contentChangeRafRef.current);
      contentChangeRafRef.current = 0;
    }
    syncFollowState();
    doScrollToBottom();
  }, [resetKey, doScrollToBottom, syncFollowState]);

  const captureAnchor = useCallback((): AnchorInfo | null => {
    const el = ref.current;
    if (!el) return null;
    const found = findFirstVisibleMessage(el);
    if (!found) return null;
    const containerTop = el.getBoundingClientRect().top;
    const elTop = found.el.getBoundingClientRect().top;
    return { messageId: found.id, offsetInViewport: elTop - containerTop };
  }, [ref]);

  const restoreAnchor = useCallback(
    (anchor: AnchorInfo) => {
      const el = ref.current;
      if (!el) return;
      const target = el.querySelector<HTMLElement>(
        `[data-message-id="${anchor.messageId}"]`,
      );
      if (!target) return;
      const containerTop = el.getBoundingClientRect().top;
      const currentOffset = target.getBoundingClientRect().top - containerTop;
      const delta = currentOffset - anchor.offsetInViewport;
      if (Math.abs(delta) > 0.5) {
        guardedScroll(el, el.scrollTop + delta, guardRef);
      }
    },
    [ref],
  );

  const reconcileContent = useCallback(() => {
    if (pinnedRef.current) {
      doScrollToBottom();
      return;
    }
    const anchor = currentAnchorRef.current;
    if (anchor) restoreAnchor(anchor);
  }, [doScrollToBottom, restoreAnchor]);

  const handleScroll = useCallback(() => {
    if (guardRef.current) return;
    const el = ref.current;
    if (!el) return;

    const distFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    const threshold = pinnedRef.current
      ? EXIT_FOLLOW_THRESHOLD_PX
      : ENTER_FOLLOW_THRESHOLD_PX;
    const nextPinned = distFromBottom < threshold;

    if (pinnedRef.current !== nextPinned) {
      pinnedRef.current = nextPinned;
      syncFollowState();
    }

    if (!nextPinned) {
      const anchor = captureAnchor();
      if (anchor) currentAnchorRef.current = anchor;
    } else {
      currentAnchorRef.current = null;
    }
  }, [ref, syncFollowState, captureAnchor]);

  const scrollToBottom = useCallback(() => {
    pinnedRef.current = true;
    currentAnchorRef.current = null;
    syncFollowState();
    doScrollToBottom();
  }, [doScrollToBottom, syncFollowState]);

  const scrollToBottomIfPinned = useCallback(() => {
    if (!pinnedRef.current) return;
    doScrollToBottom();
  }, [doScrollToBottom]);

  const onContentHeightChange = useCallback(
    (options?: { immediate?: boolean }) => {
      if (options?.immediate) {
        if (contentChangeRafRef.current !== 0) {
          cancelAnimationFrame(contentChangeRafRef.current);
          contentChangeRafRef.current = 0;
        }
        reconcileContent();
        return;
      }

      if (contentChangeRafRef.current !== 0) return;
      contentChangeRafRef.current = requestAnimationFrame(() => {
        contentChangeRafRef.current = 0;
        reconcileContent();
      });
    },
    [reconcileContent],
  );

  return {
    handleScroll,
    scrollToBottom,
    scrollToBottomIfPinned,
    isAutoFollowing,
    captureAnchor,
    restoreAnchor,
    onContentHeightChange,
  };
}
