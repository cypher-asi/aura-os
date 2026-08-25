import { buildUserChatMessage } from "../../../hooks/attachment-helpers";
import type { QueuedMessage } from "../../../stores/message-queue-store";
import type { DisplaySessionEvent } from "../../../shared/types/stream";

/**
 * Represent a queued send in the same transcript as persisted and
 * in-flight messages. The queue id is also the stable React identity
 * threaded into the eventual transport send, so dispatching the item
 * updates this bubble in place instead of making the prompt disappear
 * between the queue and stream stores.
 */
export function queuedMessageToDisplayEvent(
  message: QueuedMessage,
): DisplaySessionEvent {
  const trimmed = message.content.trim();
  const fallback =
    message.action === "generate_specs"
      ? "Generate specs for this project"
      : message.generationMode === "3d" && message.sourceImageUrl
        ? "Generate 3D model"
        : undefined;
  const event = buildUserChatMessage(trimmed, message.attachments, fallback);

  return {
    ...event,
    id: message.id,
    clientId: message.id,
    deliveryStatus: "queued",
  };
}

export function appendQueuedDisplayMessages(
  messages: DisplaySessionEvent[],
  queue: QueuedMessage[],
): DisplaySessionEvent[] {
  if (queue.length === 0) return messages;

  const displayedIds = new Set(
    messages.flatMap((message) => [message.id, message.clientId].filter(Boolean)),
  );
  const queuedEvents = queue
    .filter((message) => !displayedIds.has(message.id))
    .map(queuedMessageToDisplayEvent);

  return queuedEvents.length === 0 ? messages : [...messages, ...queuedEvents];
}
