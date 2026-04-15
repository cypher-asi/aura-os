import { useEffect, useMemo } from "react";
import { useStreamEvents } from "./stream/hooks";
import { useMessageStore } from "../stores/message-store";
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

/**
 * Merge stored (persisted) messages with ephemeral stream messages.
 * Deduplicates by ID and filters temp messages that match a persisted version.
 */
function combineStoredAndStreamMessages(
  storedMessages: DisplaySessionEvent[],
  streamMessages: DisplaySessionEvent[],
): DisplaySessionEvent[] {
  if (storedMessages.length === 0) {
    return streamMessages;
  }
  if (streamMessages.length === 0) {
    return storedMessages;
  }

  const storedIds = new Set(storedMessages.map((message) => message.id));
  const lastStoredMessage = storedMessages[storedMessages.length - 1];
  const liveOnlyMessages = streamMessages.filter((message) => {
    if (storedIds.has(message.id)) {
      return false;
    }
    if (isPersistedVersionOfTempMessage(lastStoredMessage, message)) {
      return false;
    }
    return true;
  });
  if (liveOnlyMessages.length === 0) {
    return storedMessages;
  }
  return [...storedMessages, ...liveOnlyMessages];
}

export function useConversationSnapshot(
  streamKey: string,
  historyMessages?: DisplaySessionEvent[],
): {
  messages: DisplaySessionEvent[];
} {
  useEffect(() => {
    if (historyMessages && historyMessages.length > 0) {
      useMessageStore.getState().setThread(streamKey, historyMessages);
    }
  }, [streamKey, historyMessages]);

  const streamMessages = useStreamEvents(streamKey);

  const messages = useMemo(() => {
    const stored = useMessageStore.getState().getThreadMessages(streamKey);
    if (stored.length > 0) {
      return combineStoredAndStreamMessages(stored, streamMessages);
    }
    return combineStoredAndStreamMessages(historyMessages ?? [], streamMessages);
  }, [streamKey, streamMessages, historyMessages]);

  return { messages };
}
