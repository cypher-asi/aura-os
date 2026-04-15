import { type ReactNode, type RefObject, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { MessageBubble } from "../MessageBubble";
import { StreamingBubble } from "../StreamingBubble";
import type { DisplaySessionEvent } from "../../types/stream";

import { useStreamStore } from "../../hooks/stream/store";

const MESSAGE_GAP = 12;
const ESTIMATED_ROW_HEIGHT = 120;

interface ChatMessageListProps {
  messages: DisplaySessionEvent[];
  streamKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  emptyState?: ReactNode;
  onTailLayoutChange?: (ready: boolean) => void;
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
  onTailLayoutChange,
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

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey,
    overscan: 5,
    gap: MESSAGE_GAP,
  });

  const hasMessages =
    messages.length > 0 || isStreaming || streamingText || thinkingText || activeToolCalls.length > 0;
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const coversTail = messages.length === 0
    ? true
    : (virtualItems[virtualItems.length - 1]?.index ?? -1) >= messages.length - 1;
  const firstRenderedIndex = virtualItems[0]?.index ?? -1;
  const lastRenderedIndex = virtualItems[virtualItems.length - 1]?.index ?? -1;
  const prevTailLayoutKeyRef = useRef<string | null>(null);
  const tailLayoutKey = useMemo(
    () => [
      coversTail ? "tail" : "partial",
      messages.length,
      firstRenderedIndex,
      lastRenderedIndex,
      Math.round(totalSize),
      activeToolCalls.length,
      Boolean(streamingText),
      Boolean(thinkingText),
      isStreaming ? "streaming" : "idle",
    ].join(":"),
    [
      activeToolCalls.length,
      coversTail,
      firstRenderedIndex,
      isStreaming,
      lastRenderedIndex,
      messages.length,
      streamingText,
      thinkingText,
      totalSize,
    ],
  );

  useLayoutEffect(() => {
    const nextKey = hasMessages ? tailLayoutKey : "empty";
    if (prevTailLayoutKeyRef.current === nextKey) {
      return;
    }
    prevTailLayoutKeyRef.current = nextKey;
    onTailLayoutChange?.(hasMessages ? coversTail : true);
  }, [coversTail, hasMessages, onTailLayoutChange, tailLayoutKey]);

  if (!hasMessages) {
    return <>{emptyState}</>;
  }

  return (
    <>
      <div style={{ position: "relative", height: totalSize, flexShrink: 0 }}>
        {virtualItems.map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              display: "flex",
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <MessageBubble message={messages[virtualRow.index]} />
          </div>
        ))}
      </div>
      {(isStreaming || streamingText || thinkingText || activeToolCalls.length > 0) && (
        <StreamingBubble
          isStreaming={isStreaming}
          text={streamingText}
          toolCalls={activeToolCalls}
          thinkingText={thinkingText}
          thinkingDurationMs={thinkingDurationMs}
          timeline={timeline}
          progressText={progressText}
        />
      )}
    </>
  );
}
