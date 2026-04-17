import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { MessageBubble } from "../MessageBubble";
import { StreamingBubble } from "../StreamingBubble";
import type { DisplaySessionEvent } from "../../types/stream";
import type { MessageHeightCache } from "../../hooks/use-message-height-cache";

import { useStreamStore } from "../../hooks/stream/store";

const MESSAGE_GAP = 2;

interface ChatMessageListProps {
  messages: DisplaySessionEvent[];
  streamKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  emptyState?: ReactNode;
  heightCache: MessageHeightCache;
  onLoadOlder?: () => void;
  isLoadingOlder?: boolean;
  hasOlderMessages?: boolean;
  onContentHeightChange?: (options?: { immediate?: boolean }) => void;
  onInitialAnchorReady?: () => void;
  isAutoFollowing?: boolean;
}

const EMPTY_TOOL_CALLS: NonNullable<
  ReturnType<typeof useStreamStore.getState>["entries"][string]
>["activeToolCalls"] = [];
const EMPTY_TIMELINE: NonNullable<
  ReturnType<typeof useStreamStore.getState>["entries"][string]
>["timeline"] = [];

export function ChatMessageList({
  messages,
  streamKey,
  scrollRef,
  emptyState,
  heightCache,
  onLoadOlder,
  isLoadingOlder,
  hasOlderMessages,
  onContentHeightChange,
  onInitialAnchorReady,
  isAutoFollowing = true,
}: ChatMessageListProps) {
  const {
    isStreaming,
    streamingText,
    thinkingText,
    thinkingDurationMs,
    activeToolCalls,
    timeline,
    progressText,
  } = useStreamStore(
    useShallow((state) => ({
      isStreaming: state.entries[streamKey]?.isStreaming ?? false,
      streamingText: state.entries[streamKey]?.streamingText ?? "",
      thinkingText: state.entries[streamKey]?.thinkingText ?? "",
      thinkingDurationMs: state.entries[streamKey]?.thinkingDurationMs ?? null,
      activeToolCalls: state.entries[streamKey]?.activeToolCalls ?? EMPTY_TOOL_CALLS,
      timeline: state.entries[streamKey]?.timeline ?? EMPTY_TIMELINE,
      progressText: state.entries[streamKey]?.progressText ?? "",
    })),
  );

  const getItemKey = useCallback(
    (index: number) => messages[index].id,
    [messages],
  );

  const estimateSize = useCallback(
    (index: number) => {
      const msg = messages[index];
      if (!msg) return 120;
      return heightCache.getHeight(msg.id) ?? heightCache.estimateHeight(msg);
    },
    [messages, heightCache],
  );

  const isAutoFollowingRef = useRef(isAutoFollowing);
  isAutoFollowingRef.current = isAutoFollowing;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: 5,
    gap: MESSAGE_GAP,
  });

  // When the user is pinned to the bottom, keep every item size change
  // synchronously re-anchored so the visible bottom doesn't pop. The
  // virtualizer applies the delta to scrollTop inside its own ResizeObserver
  // callback (pre-paint, same frame as the layout change), eliminating the
  // one-frame lag between the DOM re-wrap and React's re-render of the
  // virtualizer wrapper's totalSize. When reading (scrolled up), fall back to
  // the default behavior that only compensates for items above the viewport.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    if (isAutoFollowingRef.current) return true;
    return item.start < instance.getScrollOffset() + instance.scrollAdjustments;
  };

  const measureElementRef = useRef(virtualizer.measureElement);
  measureElementRef.current = virtualizer.measureElement;
  const resizeObserversRef = useRef(new Map<string, ResizeObserver>());

  const updateMeasuredHeight = useCallback(
    (messageId: string, node: HTMLElement) => {
      const nextHeight = node.getBoundingClientRect().height;
      if (nextHeight <= 0) {
        return;
      }
      heightCache.setHeight(messageId, nextHeight);
    },
    [heightCache],
  );

  // Observe each virtualized message so we can keep `heightCache` hot for
  // messages that later scroll out of the virtualizer's active window. The
  // virtualizer runs its own ResizeObserver via `measureElement` to drive
  // `totalSize`; scroll-position corrections are handled from a single
  // post-commit effect below (keyed on `totalSize`), not from inside these
  // observer callbacks, so we don't fight the virtualizer's commit cycle
  // with stale `scrollHeight` reads.
  const makeMeasureRef = useCallback(
    (messageId: string) => (node: HTMLElement | null) => {
      const existingObserver = resizeObserversRef.current.get(messageId);
      if (!node) {
        existingObserver?.disconnect();
        resizeObserversRef.current.delete(messageId);
        measureElementRef.current(node);
        return;
      }

      measureElementRef.current(node);
      updateMeasuredHeight(messageId, node);

      existingObserver?.disconnect();
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          measureElementRef.current(node);
          updateMeasuredHeight(messageId, node);
        });
        observer.observe(node);
        resizeObserversRef.current.set(messageId, observer);
      }
    },
    [updateMeasuredHeight],
  );

  const nowStreaming = isStreaming || !!streamingText || !!thinkingText || activeToolCalls.length > 0;
  const prevStreamingRef = useRef(nowStreaming);
  const justFinalizedIdRef = useRef<string | null>(null);

  // Detect the streaming -> not streaming transition during render so the
  // MessageBubble rendered below picks up `initialThinkingExpanded` on the
  // same pass it mounts. Mark the last message as "just finalized" so its
  // ThinkingRow mounts already expanded, matching the StreamingBubble it
  // replaces.
  {
    const wasStreaming = prevStreamingRef.current;
    if (wasStreaming && !nowStreaming) {
      const lastMsg = messages[messages.length - 1];
      justFinalizedIdRef.current = lastMsg ? lastMsg.id : null;
    }
    prevStreamingRef.current = nowStreaming;
  }

  const hasMessages =
    messages.length > 0 || isStreaming || streamingText || thinkingText || activeToolCalls.length > 0;
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
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
    onContentHeightChange?.({ immediate: true });
    onInitialAnchorReady?.();
  }, [hasMessages, onContentHeightChange, onInitialAnchorReady, streamKey]);

  // Single post-commit, pre-paint scroll correction. Runs whenever the
  // virtualizer's total size changes (height cache updates, load older,
  // resize-driven rewrapping) or the streaming bubble's content changes.
  // At this point React has just committed the new wrapper height, so
  // `scrollHeight` is fresh — both the pinned-to-bottom and anchor-restore
  // paths see accurate geometry.
  useLayoutEffect(() => {
    if (!hasMessages) return;
    onContentHeightChange?.({ immediate: true });
  }, [
    hasMessages,
    onContentHeightChange,
    totalSize,
    streamingText,
    thinkingText,
    activeToolCalls.length,
    progressText,
  ]);

  useEffect(() => () => {
    for (const observer of resizeObserversRef.current.values()) {
      observer.disconnect();
    }
    resizeObserversRef.current.clear();
  }, []);

  if (!hasMessages) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {hasOlderMessages && (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
          {isLoadingOlder ? (
            <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>Loading...</span>
          ) : (
            <button
              type="button"
              onClick={onLoadOlder}
              style={{
                background: "none",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                padding: "6px 16px",
                color: "var(--color-text-secondary)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Load older messages
            </button>
          )}
        </div>
      )}
      <div style={{ position: "relative", height: totalSize, flexShrink: 0 }}>
        {virtualItems.map((virtualRow) => {
          const msg = messages[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              data-message-id={msg.id}
              ref={makeMeasureRef(msg.id)}
              style={{
                display: "flex",
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <MessageBubble
                message={msg}
                isStreaming={isStreaming && msg.id.startsWith("stream-")}
                initialThinkingExpanded={msg.id === justFinalizedIdRef.current}
                initialActivitiesExpanded={msg.id === justFinalizedIdRef.current}
              />
            </div>
          );
        })}
      </div>
      {nowStreaming && (
        <div>
          <StreamingBubble
            isStreaming={isStreaming}
            text={streamingText}
            toolCalls={activeToolCalls}
            thinkingText={thinkingText}
            thinkingDurationMs={thinkingDurationMs}
            timeline={timeline}
            progressText={progressText}
          />
        </div>
      )}
    </>
  );
}
