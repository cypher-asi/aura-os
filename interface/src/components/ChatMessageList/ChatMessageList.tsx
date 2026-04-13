import { type ReactNode, type RefObject, useCallback, useEffect, useRef } from "react";
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

  const initialMountRef = useRef(true);
  useEffect(() => {
    if (messages.length > 0) {
      initialMountRef.current = false;
    }
  }, [messages.length]);

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

  const hasMessages = messages.length > 0 || isStreaming || streamingText || thinkingText;

  if (!hasMessages) {
    return <>{emptyState}</>;
  }

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <>
      <div style={{ position: "relative", height: virtualizer.getTotalSize(), flexShrink: 0 }}>
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
            <MessageBubble message={messages[virtualRow.index]} fadeIn={initialMountRef.current} />
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
