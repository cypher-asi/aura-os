import { useMemo } from "react";
import { useStreamEvents } from "./stream/hooks";
import type { DisplaySessionEvent } from "../types/stream";

function contentBlocksMatch(
  first: DisplaySessionEvent["contentBlocks"],
  second: DisplaySessionEvent["contentBlocks"],
): boolean {
  if (first === second) {
    return true;
  }
  if (!first || !second || first.length !== second.length) {
    return false;
  }

  return first.every((block, index) => {
    const other = second[index];
    if (!other || block.type !== other.type) {
      return false;
    }
    if (block.type === "text" && other.type === "text") {
      return block.text === other.text;
    }
    if (block.type === "image" && other.type === "image") {
      return block.media_type === other.media_type && block.data === other.data;
    }
    return false;
  });
}

function isPersistedVersionOfTempMessage(
  historyMessage: DisplaySessionEvent | undefined,
  streamMessage: DisplaySessionEvent,
): boolean {
  if (!historyMessage) {
    return false;
  }

  return (
    streamMessage.id.startsWith("temp-") &&
    historyMessage.role === "user" &&
    streamMessage.role === "user" &&
    historyMessage.content === streamMessage.content &&
    contentBlocksMatch(historyMessage.contentBlocks, streamMessage.contentBlocks)
  );
}

function combineHistoryAndStreamMessages(
  historyMessages: DisplaySessionEvent[] | undefined,
  streamMessages: DisplaySessionEvent[],
): DisplaySessionEvent[] {
  if (!historyMessages || historyMessages.length === 0) {
    return streamMessages;
  }
  if (streamMessages.length === 0) {
    return historyMessages;
  }

  const historyIds = new Set(historyMessages.map((message) => message.id));
  const lastHistoryMessage = historyMessages[historyMessages.length - 1];
  const liveOnlyMessages = streamMessages.filter((message) => {
    if (historyIds.has(message.id)) {
      return false;
    }
    if (isPersistedVersionOfTempMessage(lastHistoryMessage, message)) {
      return false;
    }
    return true;
  });
  if (liveOnlyMessages.length === 0) {
    return historyMessages;
  }
  return [...historyMessages, ...liveOnlyMessages];
}

export function useConversationSnapshot(
  streamKey: string,
  historyMessages?: DisplaySessionEvent[],
): {
  messages: DisplaySessionEvent[];
} {
  const streamMessages = useStreamEvents(streamKey);
  const messages = useMemo(
    () => combineHistoryAndStreamMessages(historyMessages, streamMessages),
    [historyMessages, streamMessages],
  );

  return { messages };
}
