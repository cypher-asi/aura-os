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
 *
 * Strategy:
 *   1. Stream messages whose stable `id` already exists in `stored` are
 *      dropped, and the matched stored indices are recorded as anchors.
 *      These come from `handleEventSaved`, which substitutes the saved
 *      event (with its server-assigned `event_id`) into the stream when
 *      the backend emits `message_end`.
 *   2. If the tail of `stored` sequence-matches the *entire* remaining
 *      stream by role+content, history has fully caught up and every
 *      optimistic stream row can be dropped.
 *   3. Otherwise, an optimistic stream row is content-dedup'd ONLY when
 *      its candidate stored index is positionally anchored — i.e. it sits
 *      immediately next to an already-matched anchor, or is the final
 *      stored row. This prevents a stale older row with identical content
 *      (e.g. a previous "test" message) from silently swallowing the
 *      fresh optimistic bubble the user just sent.
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

  const storedIndexById = new Map<string, number>();
  storedMessages.forEach((message, index) => {
    storedIndexById.set(message.id, index);
  });

  const matchedStoredIndexes = new Set<number>();
  const streamAfterIdDedup: DisplaySessionEvent[] = [];
  for (const message of streamMessages) {
    const matchedIndex = storedIndexById.get(message.id);
    if (matchedIndex !== undefined) {
      matchedStoredIndexes.add(matchedIndex);
      continue;
    }
    streamAfterIdDedup.push(message);
  }

  if (streamAfterIdDedup.length === 0) {
    return storedMessages;
  }

  if (streamAfterIdDedup.length <= storedMessages.length) {
    const offset = storedMessages.length - streamAfterIdDedup.length;
    let tailMatches = true;
    for (let i = 0; i < streamAfterIdDedup.length; i += 1) {
      if (!messageContentMatches(storedMessages[offset + i], streamAfterIdDedup[i])) {
        tailMatches = false;
        break;
      }
    }
    if (tailMatches) {
      return storedMessages;
    }
  }

  const liveOnlyMessages: DisplaySessionEvent[] = [];
  for (let streamIdx = 0; streamIdx < streamAfterIdDedup.length; streamIdx += 1) {
    const message = streamAfterIdDedup[streamIdx];
    if (!isOptimisticLocalMessage(message)) {
      liveOnlyMessages.push(message);
      continue;
    }

    let matched = -1;
    for (let index = storedMessages.length - 1; index >= 0; index -= 1) {
      if (matchedStoredIndexes.has(index)) continue;
      if (!messageContentMatches(storedMessages[index], message)) continue;

      // Anchor the leading stream row to stored[0] when nothing has matched
      // yet AND the stream represents a multi-row turn (user+assistant or
      // user+tool). Without this branch, a [user-temp, asst-stream] stream
      // paired with [user-real, asst-real] history — both length 2 but
      // content-mismatched on the assistant slot, so tail-matching fails —
      // leaves the user at index 0 unable to anchor (it isn't last and has
      // no matched neighbour), which is why optimistic user prompts used
      // to land in `liveOnlyMessages` while every back-walk-matched
      // assistant got dropped, manifesting as "user prompt remains, all
      // assistant content gone" right when the turn finishes.
      //
      // The `streamAfterIdDedup.length >= 2` gate keeps the original guard
      // for "lone optimistic bubble whose content happens to repeat older
      // history" (covered by the "still renders a fresh optimistic bubble
      // when identical content exists earlier in history" test): if the
      // user typed the same prompt twice and the stream only carries that
      // bubble (no following assistant row yet), we still treat it as
      // genuinely live.
      const isFirstUnmatchedHead =
        streamIdx === 0 &&
        index === 0 &&
        matchedStoredIndexes.size === 0 &&
        streamAfterIdDedup.length >= 2;
      const isAnchored =
        matchedStoredIndexes.has(index - 1) ||
        matchedStoredIndexes.has(index + 1) ||
        index === storedMessages.length - 1 ||
        isFirstUnmatchedHead;
      if (isAnchored) {
        matched = index;
        break;
      }
    }

    if (matched !== -1) {
      matchedStoredIndexes.add(matched);
    } else {
      liveOnlyMessages.push(message);
    }
  }

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
