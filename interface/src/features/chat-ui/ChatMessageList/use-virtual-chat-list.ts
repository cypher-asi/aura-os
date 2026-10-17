import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { useScrollMargin } from "../../../shared/hooks/use-scroll-margin";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import type { SessionBoundary } from "../../../hooks/use-prior-sessions";
import { readChatPosition, rememberChatPosition } from "../../../shared/lib/chat-reading-positions";

export const STREAM_TAIL_ROW_KEY = "__stream-tail__";

/** Mixed bubble sizes: short user prompts to multi-paragraph assistant
 * turns. The estimate only matters until `measureElement` settles each
 * row; 120px keeps the initial total height in a realistic range. */
const ROW_ESTIMATE_PX = 120;
const OVERSCAN_ROWS = 8;
/** Start fetching the next older page once the viewport's first
 * rendered row is within this many rows of the top of the transcript. */
const AUTO_LOAD_OLDER_ROW_THRESHOLD = 8;

export type ChatRow =
  | {
      kind: "message";
      key: string;
      msg: DisplaySessionEvent;
      boundary?: SessionBoundary;
    }
  | { kind: "stream-tail"; key: typeof STREAM_TAIL_ROW_KEY };

interface UseVirtualChatListOptions {
  readingPositionKey?: string;
  readingPositionReady?: boolean;
  rows: ChatRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  messages: DisplaySessionEvent[];
  hasMessages: boolean;
  isAutoFollowing: boolean;
  getUserUnpinnedAt?: () => number;
  onLoadOlder?: () => void;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
}

interface UseVirtualChatListResult {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  virtualItems: VirtualItem[];
  totalSize: number;
  scrollMargin: number;
}

/**
 * Owns the windowing + scroll behaviors of the chat transcript:
 *
 * - `@tanstack/react-virtual` windowing over the message rows, keyed by
 *   the stable per-message `clientId ?? id` so measured heights survive
 *   id swaps and list re-renders.
 * - Pin-to-bottom while auto-following. CSS scroll anchoring cannot
 *   track growth *at* the anchor (streaming tail) nor the estimate →
 *   measured corrections of absolutely-positioned rows, so the pin
 *   re-asserts `scrollTop = scrollHeight` whenever the virtual total
 *   size or row count changes while the user is pinned.
 * - Reading-position preservation when older content is prepended
 *   ("Load older messages" / "Load prior session"): holds the distance
 *   from the bottom constant across the prepend.
 * - Auto-loading the next older page when the user scrolls near the
 *   top of the transcript.
 */
export function useVirtualChatList({
  readingPositionKey,
  readingPositionReady = true,
  rows,
  scrollRef,
  listRef,
  messages,
  hasMessages,
  isAutoFollowing,
  getUserUnpinnedAt,
  onLoadOlder,
  hasOlderMessages,
  isLoadingOlder,
}: UseVirtualChatListOptions): UseVirtualChatListResult {
  const scrollMargin = useScrollMargin(listRef, scrollRef);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: OVERSCAN_ROWS,
    getItemKey: (index) => rows[index]?.key ?? index,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const initialPosition = readChatPosition(readingPositionKey);
  const restoreRef = useRef(initialPosition);
  const pendingRestoreRef = useRef(initialPosition?.atEnd === false);
  const restoredThisLayoutRef = useRef(false);

  // Save on actual scrolling rather than reading a newly-switched transcript
  // during unmount cleanup. Keys include the transcript/session, not just agent.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !readingPositionKey) return;
    const save = () => {
      if (pendingRestoreRef.current || !readingPositionReady) return;
      const first = virtualizer.getVirtualItems().find((item) => item.end > el.scrollTop);
      const row = first && rows[first.index];
      if (!first || !row || row.kind !== "message") return;
      rememberChatPosition(readingPositionKey, {
        rowId: row.msg.id,
        offsetWithinRow: el.scrollTop - first.start,
        scrollOffset: el.scrollTop,
        atEnd: isAutoFollowing && !(getUserUnpinnedAt?.() ?? 0),
      });
    };
    const cancelRestore = () => { pendingRestoreRef.current = false; };
    el.addEventListener("scroll", save);
    el.addEventListener("wheel", cancelRestore, { passive: true });
    el.addEventListener("touchstart", cancelRestore, { passive: true });
    el.addEventListener("pointerdown", cancelRestore);
    const keyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancelRestore();
    };
    el.addEventListener("keydown", keyDown);
    return () => {
      el.removeEventListener("scroll", save);
      el.removeEventListener("wheel", cancelRestore);
      el.removeEventListener("touchstart", cancelRestore);
      el.removeEventListener("pointerdown", cancelRestore);
      el.removeEventListener("keydown", keyDown);
    };
  }, [scrollRef, readingPositionKey, readingPositionReady, virtualizer, rows, isAutoFollowing, getUserUnpinnedAt]);

  useLayoutEffect(() => {
    restoredThisLayoutRef.current = false;
    if (!pendingRestoreRef.current || !hasMessages || !readingPositionReady) return;
    const el = scrollRef.current;
    const saved = restoreRef.current;
    if (!el || !saved) return;
    // Explicit Jump to latest / Send wins over restoration and late hydration.
    if (readChatPosition(readingPositionKey)?.atEnd) {
      pendingRestoreRef.current = false;
      return;
    }
    const index = rows.findIndex((row) => row.kind === "message" && row.msg.id === saved.rowId);
    if (index < 0) {
      if (!hasOlderMessages && !isLoadingOlder) {
        restoredThisLayoutRef.current = true;
        el.scrollTop = Math.min(saved.scrollOffset, Math.max(0, el.scrollHeight - el.clientHeight));
        pendingRestoreRef.current = false;
      }
      return;
    }
    const align = () => {
      if (!pendingRestoreRef.current) return;
      const item = virtualizer.getVirtualItems().find((item) => item.index === index);
      if (item) {
        restoredThisLayoutRef.current = true;
        el.scrollTop = Math.max(0, item.start + saved.offsetWithinRow);
      }
      else virtualizer.scrollToIndex(index, { align: "start" });
    };
    align();
    // Allow the virtual row to mount and measure before the final correction.
    let frame = requestAnimationFrame(() => {
      align();
      frame = requestAnimationFrame(() => {
        align();
        pendingRestoreRef.current = false;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [rows, hasMessages, totalSize, scrollRef, virtualizer, readingPositionKey, readingPositionReady, hasOlderMessages, isLoadingOlder]);

  useEffect(() => {
    const saved = restoreRef.current;
    if (pendingRestoreRef.current && saved && readingPositionReady && hasMessages && hasOlderMessages && !isLoadingOlder
      && !rows.some((row) => row.kind === "message" && row.msg.id === saved.rowId)) {
      onLoadOlder?.();
    }
  }, [rows, hasMessages, readingPositionReady, hasOlderMessages, isLoadingOlder, onLoadOlder]);

  // Pin to bottom while the tail grows or measurements correct the
  // virtual total height. The `getUserUnpinnedAt` check is defense in
  // depth against same-tick races where the user's wheel/touch event
  // fires after this layout effect has been scheduled but before
  // `isAutoFollowing` re-renders.
  useLayoutEffect(() => {
    if (!hasMessages || !isAutoFollowing) return;
    if (pendingRestoreRef.current) return;
    if (getUserUnpinnedAt && getUserUnpinnedAt() > 0) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    hasMessages,
    isAutoFollowing,
    getUserUnpinnedAt,
    scrollRef,
    rows.length,
    totalSize,
  ]);

  // Keep the viewport stable when older content is prepended. Setting
  // `scrollTop` to an absolute computed value (rather than nudging by a
  // delta) is idempotent, so it cannot double-compensate with any other
  // scroll adjustment that landed this frame. Detected via the top
  // message id changing to an older message while the previous top
  // message is still present further down the list.
  const prevScrollMetricsRef = useRef({ scrollHeight: 0, distanceFromBottom: 0 });
  const prevTopMessageIdRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const topId = messages[0]?.id;
    const prevTopId = prevTopMessageIdRef.current;
    if (
      prevTopId !== undefined &&
      !isAutoFollowing &&
      !pendingRestoreRef.current &&
      !restoredThisLayoutRef.current &&
      topId !== prevTopId &&
      messages.some((m) => m.id === prevTopId)
    ) {
      el.scrollTop = el.scrollHeight - prevScrollMetricsRef.current.distanceFromBottom;
    }
    prevScrollMetricsRef.current = {
      scrollHeight: el.scrollHeight,
      distanceFromBottom: el.scrollHeight - el.scrollTop,
    };
    prevTopMessageIdRef.current = topId;
  }, [messages, scrollRef, isAutoFollowing]);

  // Infinite upward scroll: fetch the next older page as the first
  // rendered row approaches the top of the transcript. Gated on the
  // user actually reading upward (`!isAutoFollowing`) so a fresh mount
  // pinned to the bottom never fires a spurious page fetch.
  const firstVisibleIndex = virtualItems[0]?.index ?? 0;
  useEffect(() => {
    if (!onLoadOlder || !hasOlderMessages || isLoadingOlder) return;
    if (pendingRestoreRef.current) return;
    if (isAutoFollowing) return;
    if (firstVisibleIndex > AUTO_LOAD_OLDER_ROW_THRESHOLD) return;
    onLoadOlder();
  }, [
    onLoadOlder,
    hasOlderMessages,
    isLoadingOlder,
    isAutoFollowing,
    firstVisibleIndex,
  ]);

  return { virtualizer, virtualItems, totalSize, scrollMargin };
}
