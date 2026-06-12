import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import { useScrollMargin } from "../../../shared/hooks/use-scroll-margin";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import type { SessionBoundary } from "../../../hooks/use-prior-sessions";

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

  // Pin to bottom while the tail grows or measurements correct the
  // virtual total height. The `getUserUnpinnedAt` check is defense in
  // depth against same-tick races where the user's wheel/touch event
  // fires after this layout effect has been scheduled but before
  // `isAutoFollowing` re-renders.
  useLayoutEffect(() => {
    if (!hasMessages || !isAutoFollowing) return;
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
  }, [messages, scrollRef]);

  // Infinite upward scroll: fetch the next older page as the first
  // rendered row approaches the top of the transcript. Gated on the
  // user actually reading upward (`!isAutoFollowing`) so a fresh mount
  // pinned to the bottom never fires a spurious page fetch.
  const firstVisibleIndex = virtualItems[0]?.index ?? 0;
  useEffect(() => {
    if (!onLoadOlder || !hasOlderMessages || isLoadingOlder) return;
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
