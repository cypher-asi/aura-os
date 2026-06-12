import {
  memo,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { MessageBubble } from "../../../apps/chat/components/MessageBubble";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import type { ErrorReportAgentInfo } from "../../../hooks/use-error-report-agent-info";

import { useStreamStore } from "../../../hooks/stream/store";
import { useImageScrollPin } from "../../../shared/hooks/use-image-scroll-pin";
import { SessionGalleryContext } from "../../../components/Gallery";
import { collectSessionImages } from "./collect-session-images";
import { PriorSessionDivider } from "./PriorSessionDivider";
import { StreamingTail } from "./StreamingTail";
import {
  STREAM_TAIL_ROW_KEY,
  useVirtualChatList,
  type ChatRow,
} from "./use-virtual-chat-list";
import type { SessionBoundary } from "../../../hooks/use-prior-sessions";
import styles from "./ChatMessageList.module.css";

interface ChatMessageListProps {
  messages: DisplaySessionEvent[];
  streamKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  emptyState?: ReactNode;
  onLoadOlder?: () => void;
  isLoadingOlder?: boolean;
  hasOlderMessages?: boolean;
  /** Loads the chronologically previous session above the current chat. */
  onLoadPriorSession?: () => void;
  hasPriorSession?: boolean;
  isLoadingPriorSession?: boolean;
  /** Labeled dividers inserted before the first message of each session block. */
  sessionBoundaries?: SessionBoundary[];
  onInitialAnchorReady?: () => void;
  /**
   * Resend the most-recent prompt for this stream. Forwarded to each
   * `MessageBubble` so error bubbles can render a manual Retry button.
   * Optional because read-only/historical surfaces don't supply it.
   */
  onRetry?: () => void;
  /**
   * Agent + device context forwarded to each error bubble so a
   * user-shared failure carries the agent name, local/remote type,
   * status, and device. Optional on read-only/historical surfaces.
   */
  errorAgentInfo?: ErrorReportAgentInfo;
  /** Agent id forwarded to error bubbles' `ReportBugButton`. */
  agentId?: string;
  isAutoFollowing?: boolean;
  /** Returns a non-zero `performance.now()` timestamp once the user has
   * shown explicit upward scroll intent (wheel/touch/keyboard). When
   * non-zero, the tail-pin layout effect and `useImageScrollPin` both
   * suppress writes to `scrollTop` so the user's reading position is
   * preserved during streams and the post-stream image-pin window. */
  getUserUnpinnedAt?: () => number;
  density?: "desktop" | "mobile";
  /** Optional UNIX-ms deadline; while now < deadline, image-load
   * events re-pin the scroll container even if the user isn't strictly
   * auto-following yet. Used by `ChatPanel` to keep the cold-load
   * reveal anchored while attachments decode. */
  imagePinUntil?: number;
}

/**
 * Renders the chat transcript through a `@tanstack/react-virtual`
 * window, so only the rows near the viewport are mounted regardless of
 * transcript length. Scroll behaviors (pin-to-bottom, prepend
 * preservation, auto-load-older) live in `useVirtualChatList`.
 *
 * This component subscribes to the stream store through *boolean*
 * selectors only (streaming on/off, live text present, ...), so
 * per-token word-reveal ticks re-render just the `StreamingTail` row —
 * not the historical row map. Tail growth still reaches the pin logic
 * because `measureElement` re-measures the tail row, which updates the
 * virtualizer's total size.
 *
 * Wrapped in `React.memo` (see export below) so draft-input keystrokes
 * in the parent `ChatSurface` don't re-run the transcript.
 */
function ChatMessageListImpl({
  messages,
  streamKey,
  scrollRef,
  emptyState,
  onLoadOlder,
  isLoadingOlder,
  hasOlderMessages,
  onLoadPriorSession,
  hasPriorSession,
  isLoadingPriorSession,
  sessionBoundaries,
  onInitialAnchorReady,
  onRetry,
  errorAgentInfo,
  agentId,
  isAutoFollowing = true,
  getUserUnpinnedAt,
  density = "desktop",
  imagePinUntil,
}: ChatMessageListProps) {
  useImageScrollPin(scrollRef, {
    isAutoFollowing,
    initialRevealUntil: imagePinUntil,
    getUserUnpinnedAt,
  });
  // Boolean-only projection of the live stream so this component
  // re-renders on streaming *transitions*, not on every token tick.
  // The full per-token fields are consumed by `StreamingTail`.
  const { isStreaming, hasLiveText, hasActiveTools, hasTimeline } = useStreamStore(
    useShallow((state) => {
      const entry = state.entries[streamKey];
      return {
        isStreaming: entry?.isStreaming ?? false,
        hasLiveText: !!(entry?.streamingText || entry?.thinkingText),
        hasActiveTools: (entry?.activeToolCalls?.length ?? 0) > 0,
        hasTimeline: (entry?.timeline?.length ?? 0) > 0,
      };
    }),
  );

  const nowStreaming = isStreaming || hasLiveText || hasActiveTools;
  const visibleMessages =
    hasLiveText && messages.length > 0 && messages[messages.length - 1].role === "assistant"
      ? messages.slice(0, -1)
      : messages;
  // Session-wide gallery list. Recomputed only when the visible
  // message slice changes (not on every streaming token), then
  // published via context so any image click inside a bubble can open
  // the shared overlay with the full set + forward/back navigation.
  const sessionGalleryImages = useMemo(
    () => collectSessionImages(visibleMessages),
    [visibleMessages],
  );
  const boundaryByEventId = useMemo(() => {
    const map = new Map<string, SessionBoundary>();
    for (const boundary of sessionBoundaries ?? []) {
      map.set(boundary.firstEventId, boundary);
    }
    return map;
  }, [sessionBoundaries]);
  const prevStreamingRef = useRef(nowStreaming);
  const justFinalizedIdRef = useRef<string | null>(null);

  // Detect streaming -> not-streaming transition during render so the
  // MessageBubble for the just-finalized message mounts with its activity
  // rows expanded, matching the live assistant row it replaces. This has
  // to happen during render (not useEffect) because `initialActivitiesExpanded`
  // is read once at MessageBubble mount — deferring to useEffect means the
  // bubble mounts collapsed for one frame and then can't be re-expanded.
  // React Compiler's "no refs during render" rule doesn't distinguish this
  // legitimate render-phase derivation from genuine misuse, so we disable it
  // narrowly for this block.
  /* eslint-disable react-hooks/refs */
  {
    const wasStreaming = prevStreamingRef.current;
    if (wasStreaming && !nowStreaming) {
      const lastMsg = messages[messages.length - 1];
      justFinalizedIdRef.current = lastMsg ? lastMsg.id : null;
    }
    prevStreamingRef.current = nowStreaming;
  }
  /* eslint-enable react-hooks/refs */

  const hasMessages = messages.length > 0 || nowStreaming || hasTimeline;

  const initialLayoutReadyKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!hasMessages) {
      initialLayoutReadyKeyRef.current = null;
      return;
    }
    const initialLayoutReadyKey = `${streamKey}:ready`;
    if (initialLayoutReadyKeyRef.current === initialLayoutReadyKey) {
      return;
    }
    initialLayoutReadyKeyRef.current = initialLayoutReadyKey;
    onInitialAnchorReady?.();
  }, [hasMessages, onInitialAnchorReady, streamKey]);

  const rows = useMemo<ChatRow[]>(() => {
    const out: ChatRow[] = visibleMessages.map((msg) => ({
      kind: "message",
      key: msg.clientId ?? msg.id,
      msg,
      boundary: boundaryByEventId.get(msg.id),
    }));
    if (nowStreaming) {
      out.push({ kind: "stream-tail", key: STREAM_TAIL_ROW_KEY });
    }
    return out;
  }, [visibleMessages, boundaryByEventId, nowStreaming]);

  const listRef = useRef<HTMLDivElement>(null);
  const { virtualizer, virtualItems, totalSize, scrollMargin } = useVirtualChatList({
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
  });

  if (!hasMessages) {
    return <>{emptyState}</>;
  }

  const rowDensityClass =
    density === "mobile" ? styles.virtualRowMobile : styles.virtualRowDesktop;

  return (
    <>
      {hasPriorSession && (
        <div className={styles.loaderRow}>
          {isLoadingPriorSession ? (
            <span className={styles.loaderText}>Loading...</span>
          ) : (
            <button
              type="button"
              className={styles.loaderButton}
              onClick={onLoadPriorSession}
            >
              Load prior session
            </button>
          )}
        </div>
      )}
      {hasOlderMessages && (
        <div className={styles.loaderRow}>
          {isLoadingOlder ? (
            <span className={styles.loaderText}>Loading...</span>
          ) : (
            <button
              type="button"
              className={styles.loaderButton}
              onClick={onLoadOlder}
            >
              Load older messages
            </button>
          )}
        </div>
      )}
      <SessionGalleryContext.Provider value={sessionGalleryImages}>
        <div
          ref={listRef}
          className={styles.virtualList}
          style={{ height: `${totalSize}px` }}
        >
          {/* eslint-disable-next-line react-hooks/refs -- reading justFinalizedIdRef.current here is part of the intentional render-phase pattern documented above the transition detection */}
          {virtualItems.map((vi) => {
            const row = rows[vi.index];
            if (!row) return null;
            return (
              <div
                key={vi.key}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                className={`${styles.virtualRow} ${rowDensityClass}`}
                style={{ transform: `translateY(${vi.start - scrollMargin}px)` }}
              >
                {row.kind === "message" ? (
                  <>
                    {row.boundary && (
                      <PriorSessionDivider
                        label={row.boundary.label}
                        startedAt={row.boundary.startedAt}
                      />
                    )}
                    <div data-message-id={row.msg.id} className={styles.messageRow}>
                      <MessageBubble
                        message={row.msg}
                        isStreaming={isStreaming && row.msg.id.startsWith("stream-")}
                        initialActivitiesExpanded={
                          row.msg.id === justFinalizedIdRef.current
                        }
                        streamKey={streamKey}
                        agentId={agentId}
                        errorAgentInfo={errorAgentInfo}
                        onRetry={onRetry}
                      />
                    </div>
                  </>
                ) : (
                  <StreamingTail streamKey={streamKey} />
                )}
              </div>
            );
          })}
        </div>
      </SessionGalleryContext.Provider>
    </>
  );
}

export const ChatMessageList = memo(ChatMessageListImpl);
ChatMessageList.displayName = "ChatMessageList";
