import type { DisplaySessionEvent } from "../../shared/types/stream";

/**
 * Trailing-edge debounce window for refetches triggered by
 * `assistant_turn_progress` heartbeats. The server already throttles
 * publishes to roughly one every 400ms; this window adds a second
 * coalescing layer so concurrent listeners never produce more than one
 * history fetch per ~250ms while a turn is streaming.
 */
export const PROGRESS_REFETCH_DEBOUNCE_MS = 250;

/**
 * Grace window after a streaming → not-streaming transition during which
 * we refuse to overwrite live stream events with a *shorter* history
 * snapshot. The forced `fetchHistory({ force: true })` call that fires
 * on stream finish often races with the server-side persistence of the
 * trailing `assistant_message_end`, so we frequently see a "user only"
 * snapshot land before the assistant row exists in storage. Without
 * this guard that snapshot would replace the just-finalized stream
 * events and the assistant content would visibly disappear at end of
 * turn (full content reappearing only on a hard reload, since the
 * server eventually persists it).
 *
 * 1500ms covered the typical persistence lag, but under load — long
 * tool-result writes, slow storage round trips, or a heavy harness
 * burst — we occasionally still saw the assistant turn flash to empty
 * before the next refetch caught up, which presented as the main chat
 * "just getting dropped with no explanation." 5000ms covers the worst
 * observed persistence lag with comfortable headroom; the staleness
 * guards below still let legitimate cross-session refreshes land
 * promptly because they short-circuit when history is provably newer
 * than the stream.
 */
export const STREAM_FINISH_GRACE_MS = 5000;

export function hasTransientStreamError(events: DisplaySessionEvent[]): boolean {
  return events.some((event) =>
    event.id.startsWith("error-") || event.displayVariant != null
  );
}

export function assistantHasVisibleActivity(event: DisplaySessionEvent | undefined): boolean {
  return !!(
    event &&
    event.role === "assistant" &&
    (
      event.content.trim().length > 0 ||
      (event.toolCalls?.length ?? 0) > 0 ||
      (event.timeline?.length ?? 0) > 0 ||
      (event.thinkingText?.trim().length ?? 0) > 0
    )
  );
}

export function findTrailingAssistant(events: DisplaySessionEvent[]): DisplaySessionEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].role === "assistant") {
      return events[index];
    }
  }
  return undefined;
}

export function historyHasCaughtUpToStream(
  historyMessages: DisplaySessionEvent[],
  streamEvents: DisplaySessionEvent[],
): boolean {
  if (historyMessages.length < streamEvents.length) {
    return false;
  }

  const streamAssistant = findTrailingAssistant(streamEvents);
  if (!assistantHasVisibleActivity(streamAssistant)) {
    return true;
  }

  const historyAssistant = findTrailingAssistant(historyMessages);
  if (!assistantHasVisibleActivity(historyAssistant)) {
    return false;
  }

  const streamContent = streamAssistant?.content.trim() ?? "";
  if (!streamContent) {
    return true;
  }

  const historyContent = historyAssistant?.content.trim() ?? "";
  return (
    historyContent.length >= streamContent.length &&
    historyContent.startsWith(streamContent)
  );
}
