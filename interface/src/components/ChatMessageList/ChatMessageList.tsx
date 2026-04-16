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
import { useChatResizeSession } from "../ChatPanel/chat-resize-session-context";

const MESSAGE_GAP = 12;

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
  const resizeSession = useChatResizeSession();

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

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan: 5,
    gap: MESSAGE_GAP,
  });

  const measureElementRef = useRef(virtualizer.measureElement);
  measureElementRef.current = virtualizer.measureElement;
  const measureVirtualizerRef = useRef(virtualizer.measure);
  measureVirtualizerRef.current = virtualizer.measure;
  const resizeObserversRef = useRef(new Map<string, ResizeObserver>());
  const streamingBubbleRef = useRef<HTMLDivElement>(null);
  const streamingBubbleObserverRef = useRef<ResizeObserver | null>(null);
  const streamingBubbleHeightRef = useRef<number | null>(null);
  const lastStreamingBubbleHeightRef = useRef<number | null>(null);
  const streamingBubbleHeightRafRef = useRef(0);
  const resizeSettleRafRef = useRef(0);
  const lastResizeSettleRef = useRef(0);

  const scheduleStreamingBubbleHeightSync = useCallback(() => {
    if (streamingBubbleHeightRafRef.current !== 0) {
      return;
    }
    streamingBubbleHeightRafRef.current = requestAnimationFrame(() => {
      streamingBubbleHeightRafRef.current = 0;
      onContentHeightChange?.({ immediate: true });
    });
  }, [onContentHeightChange]);

  const updateMeasuredHeight = useCallback(
    (messageId: string, node: HTMLElement) => {
      const nextHeight = node.getBoundingClientRect().height;
      if (nextHeight <= 0) {
        return;
      }
      const previousHeight = heightCache.getHeight(messageId);
      heightCache.setHeight(messageId, nextHeight);
      if (
        previousHeight === undefined
        || Math.abs(previousHeight - nextHeight) >= 1
      ) {
        onContentHeightChange?.();
      }
    },
    [heightCache, onContentHeightChange],
  );

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

  const updateStreamingBubbleHeight = useCallback(
    (node: HTMLElement) => {
      const nextHeight = node.getBoundingClientRect().height;
      if (nextHeight <= 0) {
        return;
      }
      const previousHeight = streamingBubbleHeightRef.current;
      streamingBubbleHeightRef.current = nextHeight;
      lastStreamingBubbleHeightRef.current = nextHeight;
      if (previousHeight === null || Math.abs(previousHeight - nextHeight) >= 1) {
        scheduleStreamingBubbleHeightSync();
      }
    },
    [scheduleStreamingBubbleHeightSync],
  );

  const setStreamingBubbleRef = useCallback(
    (node: HTMLDivElement | null) => {
      streamingBubbleObserverRef.current?.disconnect();
      streamingBubbleObserverRef.current = null;
      streamingBubbleRef.current = node;

      if (!node) {
        streamingBubbleHeightRef.current = null;
        return;
      }

      updateStreamingBubbleHeight(node);

      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          updateStreamingBubbleHeight(node);
        });
        observer.observe(node);
        streamingBubbleObserverRef.current = observer;
      }
    },
    [updateStreamingBubbleHeight],
  );

  const nowStreaming = isStreaming || !!streamingText || !!thinkingText || activeToolCalls.length > 0;
  const prevStreamingRef = useRef(nowStreaming);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = nowStreaming;

    if (wasStreaming && !nowStreaming) {
      const lastMsg = messages[messages.length - 1];
      const height = lastStreamingBubbleHeightRef.current;
      if (lastMsg) {
        if (height && height > 0) {
          heightCache.setHeight(lastMsg.id, height);
          onContentHeightChange?.({ immediate: true });
        }
      }
    }
  }, [nowStreaming, messages, heightCache, onContentHeightChange]);

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

  useEffect(() => () => {
    for (const observer of resizeObserversRef.current.values()) {
      observer.disconnect();
    }
    resizeObserversRef.current.clear();
    streamingBubbleObserverRef.current?.disconnect();
    streamingBubbleObserverRef.current = null;
    if (resizeSettleRafRef.current !== 0) {
      cancelAnimationFrame(resizeSettleRafRef.current);
      resizeSettleRafRef.current = 0;
    }
    if (streamingBubbleHeightRafRef.current !== 0) {
      cancelAnimationFrame(streamingBubbleHeightRafRef.current);
      streamingBubbleHeightRafRef.current = 0;
    }
  }, []);

  useEffect(() => {
    if (resizeSession.isActive) {
      return;
    }
    if (resizeSession.settledAt === 0 || resizeSession.settledAt === lastResizeSettleRef.current) {
      return;
    }
    lastResizeSettleRef.current = resizeSession.settledAt;
    if (resizeSettleRafRef.current !== 0) {
      cancelAnimationFrame(resizeSettleRafRef.current);
    }
    resizeSettleRafRef.current = requestAnimationFrame(() => {
      resizeSettleRafRef.current = 0;
      measureVirtualizerRef.current?.();
      onContentHeightChange?.({ immediate: true });
    });
  }, [onContentHeightChange, resizeSession.isActive, resizeSession.settledAt]);

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
              />
            </div>
          );
        })}
      </div>
      {nowStreaming && (
        <div ref={setStreamingBubbleRef}>
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
