import { useEffect, useMemo } from "react";
import { useStreamEvents } from "./stream/hooks";
import { useMessageStore } from "../stores/message-store";
import type { DisplaySessionEvent } from "../types/stream";
import { getPendingChatMessages } from "../lib/pending-chat-messages";

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

function isOptimisticLocalMessage(message: DisplaySessionEvent): boolean {
  return message.id.startsWith("temp-") || message.id.startsWith("stream-");
}

function messageContentMatches(
  storedMessage: DisplaySessionEvent,
  streamMessage: DisplaySessionEvent,
): boolean {
  if (
    storedMessage.role !== streamMessage.role ||
    storedMessage.content !== streamMessage.content
  ) {
    return false;
  }

  if (!storedMessage.contentBlocks || !streamMessage.contentBlocks) {
    return true;
  }

  return contentBlocksMatch(storedMessage.contentBlocks, streamMessage.contentBlocks);
}

/**
 * Merge stored (persisted) messages with ephemeral stream messages.
 * Deduplicates by ID and filters optimistic local messages that already have
 * a persisted equivalent in history.
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
  const matchedStoredIndexes = new Set<number>();
  const liveOnlyMessages = streamMessages.filter((message) => {
    if (storedIds.has(message.id)) {
      return false;
    }

    if (!isOptimisticLocalMessage(message)) {
      return true;
    }

    for (let index = storedMessages.length - 1; index >= 0; index -= 1) {
      if (matchedStoredIndexes.has(index)) {
        continue;
      }

      if (messageContentMatches(storedMessages[index], message)) {
        matchedStoredIndexes.add(index);
        return false;
      }
    }

    return true;
  });
  if (liveOnlyMessages.length === 0) {
    return storedMessages;
  }
  return [...storedMessages, ...liveOnlyMessages];
}

function chooseBaseMessages(
  storedMessages: DisplaySessionEvent[],
  historyMessages: DisplaySessionEvent[],
): DisplaySessionEvent[] {
  if (storedMessages.length === 0) {
    return historyMessages;
  }
  if (historyMessages.length === 0) {
    return storedMessages;
  }

  const historyIds = new Set(historyMessages.map((message) => message.id));
  const storedIds = new Set(storedMessages.map((message) => message.id));

  const historyContainsStored = storedMessages.every((message) => historyIds.has(message.id));
  if (historyContainsStored && historyMessages.length >= storedMessages.length) {
    return historyMessages;
  }

  const storedContainsHistory = historyMessages.every((message) => storedIds.has(message.id));
  if (storedContainsHistory && storedMessages.length > historyMessages.length) {
    return storedMessages;
  }

  return historyMessages.length >= storedMessages.length
    ? historyMessages
    : storedMessages;
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
    const baseMessages = chooseBaseMessages(stored, historyMessages ?? []);
    const pendingMessages = getPendingChatMessages(streamKey);
    return combineStoredAndStreamMessages(
      baseMessages,
      [...pendingMessages, ...streamMessages],
    );
  }, [streamKey, streamMessages, historyMessages]);

  return { messages };
}
