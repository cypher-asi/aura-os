import { type ReactNode, type RefObject, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MessageBubble } from "../MessageBubble";
import { StreamingBubble } from "../StreamingBubble";

import {
  useStreamMessages,
  useIsStreaming,
  useStreamingText,
  useThinkingText,
  useThinkingDurationMs,
  useActiveToolCalls,
  useTimeline,
  useProgressText,
} from "../../hooks/stream/hooks";

const MESSAGE_GAP = 12;
const ESTIMATED_ROW_HEIGHT = 120;

interface ChatMessageListProps {
  streamKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  emptyState?: ReactNode;
}

export function ChatMessageList({ streamKey, scrollRef, emptyState }: ChatMessageListProps) {
  const messages = useStreamMessages(streamKey);
  const isStreaming = useIsStreaming(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const thinkingDurationMs = useThinkingDurationMs(streamKey);
  const activeToolCalls = useActiveToolCalls(streamKey);
  const timeline = useTimeline(streamKey);
  const progressText = useProgressText(streamKey);

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
      <div style={{ position: "relative", height: virtualizer.getTotalSize() }}>
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
