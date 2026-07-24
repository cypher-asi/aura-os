import type { DisplaySessionEvent } from "../types/stream";

/**
 * Pure projector: given the persisted history snapshot and the
 * ephemeral stream events, produce the canonical ordered transcript
 * for `ChatPanel`/`ChatMessageList`.
 *
 * Strategy (single pass, stable identities):
 *
 *   1. Stream events whose `id` already exists in `history` are
 *      dropped: the persisted row is authoritative once it lands.
 *      This covers `handleEventSaved` swapping a `stream-...`
 *      placeholder for the persisted `event_id` *and* the history
 *      refetch overlapping with the in-flight stream.
 *
 *   2. The user prompt is special-cased: the optimistic `temp-...`
 *      user row is dropped when persisted history contains the same
 *      trailing prompt and the corresponding assistant row has already
 *      landed. This covers both the user-only persistence window and a
 *      completed-turn refetch, without hiding a genuinely new repeated
 *      prompt.
 *
 *   3. Everything else from the stream (assistant placeholder,
 *      finalized assistant rows that haven't been persisted yet) is
 *      appended after the history tail in stream order.
 *
 *   4. When a history row supersedes a stream row (id match or the
 *      optimistic-user dedup), the output history row inherits the
 *      stream row's `clientId`. The stream row was rendered first, so
 *      its `clientId` is the React key already on screen — keeping it
 *      prevents the bubble from remounting (and visibly flashing /
 *      resizing) the moment the persisted row lands. The mapping is
 *      recorded in the caller-owned `clientIdAliases` registry so the
 *      identity survives the stream store's caught-up clear (which
 *      empties `stream` after the turn persists — without the
 *      registry, the next projection would flip the React key back to
 *      the persisted `event_id` and remount the bubble after all).
 *
 * No anchor rules, no backstop hacks: the upstream invariants
 * (stable `clientId`, `handleEventSaved` preserves `clientId` across
 * the persisted-id swap) make the dedup deterministic.
 */
export function projectConversation(
  history: readonly DisplaySessionEvent[],
  stream: readonly DisplaySessionEvent[],
  clientIdAliases?: Map<string, string>,
): DisplaySessionEvent[] {
  if (stream.length === 0) {
    return applyAliases(history, clientIdAliases);
  }
  if (history.length === 0) {
    return stream.slice();
  }

  const historyIds = new Set<string>();
  for (const m of history) historyIds.add(m.id);

  const lastHistory = history[history.length - 1];
  // Only dedup the optimistic temp- user against the IMMEDIATELY trailing
  // user in history. If the trailing history row is an assistant, the
  // prompt has already been answered and a content-equal optimistic temp-
  // represents a brand-new send, not a duplicate.
  const trailingPendingUser =
    lastHistory && lastHistory.role === "user" ? lastHistory : null;
  const supersededCompletedUser = findSupersededCompletedUser(
    history,
    stream,
    historyIds,
  );

  const liveOnly: DisplaySessionEvent[] = [];
  for (const message of stream) {
    if (historyIds.has(message.id)) {
      recordAlias(clientIdAliases, message.id, message.clientId ?? message.id);
      continue;
    }
    if (
      message.role === "user" &&
      isOptimisticUser(message) &&
      (
        (
          trailingPendingUser !== null &&
          messagesContentEqual(message, trailingPendingUser)
        ) ||
        message === supersededCompletedUser?.stream
      )
    ) {
      const persistedUser =
        message === supersededCompletedUser?.stream
          ? supersededCompletedUser.history
          : trailingPendingUser;
      if (persistedUser) {
        recordAlias(
          clientIdAliases,
          persistedUser.id,
          message.clientId ?? message.id,
        );
        continue;
      }
    }
    liveOnly.push(message);
  }

  const projectedHistory = applyAliases(history, clientIdAliases);

  if (liveOnly.length === 0) {
    return projectedHistory;
  }

  return [...projectedHistory, ...liveOnly];
}

/**
 * Identify the optimistic user echo for a turn whose authoritative assistant
 * event is already present in history.
 *
 * Matching the assistant by persisted id is the important guard here. Content
 * alone is insufficient because a user can intentionally send the same prompt
 * twice and receive the same short answer; hiding that second turn would be a
 * worse regression than the duplicate this reconciles.
 */
function findSupersededCompletedUser(
  history: readonly DisplaySessionEvent[],
  stream: readonly DisplaySessionEvent[],
  historyIds: ReadonlySet<string>,
): { history: DisplaySessionEvent; stream: DisplaySessionEvent } | null {
  if (history[history.length - 1]?.role !== "assistant") return null;

  let historyUserIndex = -1;
  for (let index = history.length - 2; index >= 0; index -= 1) {
    if (history[index].role === "user") {
      historyUserIndex = index;
      break;
    }
  }
  if (historyUserIndex < 0) return null;

  const persistedUser = history[historyUserIndex];
  const persistedTurnIds = new Set(
    history.slice(historyUserIndex + 1).map((message) => message.id),
  );

  for (let userIndex = stream.length - 1; userIndex >= 0; userIndex -= 1) {
    const optimisticUser = stream[userIndex];
    if (
      optimisticUser.role !== "user" ||
      !isOptimisticUser(optimisticUser) ||
      !messagesContentEqual(optimisticUser, persistedUser)
    ) {
      continue;
    }

    const hasPersistedAssistantAfter = stream
      .slice(userIndex + 1)
      .some(
        (message) =>
          message.role === "assistant" &&
          historyIds.has(message.id) &&
          persistedTurnIds.has(message.id),
      );
    if (hasPersistedAssistantAfter) {
      return { history: persistedUser, stream: optimisticUser };
    }
  }

  return null;
}

const EMPTY: DisplaySessionEvent[] = [];

function recordAlias(
  aliases: Map<string, string> | undefined,
  persistedId: string,
  clientId: string,
): void {
  if (!aliases || aliases.has(persistedId)) return;
  aliases.set(persistedId, clientId);
}

function applyAliases(
  history: readonly DisplaySessionEvent[],
  aliases: Map<string, string> | undefined,
): DisplaySessionEvent[] {
  if (history.length === 0) return EMPTY;
  if (!aliases || aliases.size === 0) return history.slice();
  return history.map((m) => {
    const alias = aliases.get(m.id);
    if (alias === undefined || alias === m.clientId) return m;
    return { ...m, clientId: alias };
  });
}

function isOptimisticUser(message: DisplaySessionEvent): boolean {
  return message.id.startsWith("temp-");
}

function messagesContentEqual(
  first: DisplaySessionEvent,
  second: DisplaySessionEvent,
): boolean {
  if (first.role !== second.role) return false;
  if (first.content !== second.content) return false;
  return contentBlocksEqual(first.contentBlocks, second.contentBlocks);
}

function contentBlocksEqual(
  first: DisplaySessionEvent["contentBlocks"],
  second: DisplaySessionEvent["contentBlocks"],
): boolean {
  if (first === second) return true;
  if (!first || !second) return !first === !second;
  if (first.length !== second.length) return false;
  for (let i = 0; i < first.length; i += 1) {
    const a = first[i];
    const b = second[i];
    if (!b || a.type !== b.type) return false;
    if (a.type === "text" && b.type === "text") {
      if (a.text !== b.text) return false;
      continue;
    }
    if (a.type === "image" && b.type === "image") {
      if (a.media_type !== b.media_type || a.data !== b.data) return false;
      continue;
    }
    return false;
  }
  return true;
}
