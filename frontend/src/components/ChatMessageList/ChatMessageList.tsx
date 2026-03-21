import { type ReactNode, useState, useEffect, useRef, startTransition } from "react";
import { MessageBubble, StreamingBubble } from "../MessageBubble";
import { CookingIndicator } from "../CookingIndicator";
import type { DisplayMessage } from "../../types/stream";
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

const INITIAL_BATCH = 10;

function useProgressiveMessages(messages: DisplayMessage[]) {
  const total = messages.length;
  const [expanded, setExpanded] = useState(false);
  const prevTotal = useRef(total);

  if (total !== prevTotal.current) {
    prevTotal.current = total;
    if (total > INITIAL_BATCH && expanded) {
      setExpanded(false);
    }
  }

  useEffect(() => {
    if (!expanded && total > INITIAL_BATCH) {
      startTransition(() => setExpanded(true));
    }
  }, [expanded, total]);

  if (total <= INITIAL_BATCH || expanded) return messages;
  return messages.slice(-INITIAL_BATCH);
}

interface ChatMessageListProps {
  streamKey: string;
  emptyState?: ReactNode;
}

export function ChatMessageList({ streamKey, emptyState }: ChatMessageListProps) {
  const messages = useStreamMessages(streamKey);
  const visibleMessages = useProgressiveMessages(messages);
  const isStreaming = useIsStreaming(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const thinkingDurationMs = useThinkingDurationMs(streamKey);
  const activeToolCalls = useActiveToolCalls(streamKey);
  const timeline = useTimeline(streamKey);
  const progressText = useProgressText(streamKey);

  const hasMessages = messages.length > 0 || isStreaming || streamingText || thinkingText;

  if (!hasMessages) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {isStreaming && !streamingText && !thinkingText && activeToolCalls.length === 0 && (
        <CookingIndicator label={progressText || "Cooking..."} />
      )}
      {(streamingText || thinkingText || activeToolCalls.length > 0) && (
        <StreamingBubble
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
