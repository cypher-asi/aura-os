import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStreamEvents } from "./stream/hooks";
import { useMessageStore } from "../stores/message-store";
import { useChatHistoryStore } from "../stores/chat-history-store";
import { projectConversation } from "../shared/lib/conversation-projector";
import type { DisplaySessionEvent } from "../shared/types/stream";

interface UseConversationSnapshotOptions {
  streamKey: string;
  transcriptKey: string;
  historyMessages?: DisplaySessionEvent[];
}

interface UseConversationSnapshotResult {
  messages: DisplaySessionEvent[];
  /**
   * Single-message bridge frame the panel can show *before* history
   * resolves so cold opens of a recently-visited session paint a real
   * bubble immediately instead of an empty / spinner panel. Sourced
   * from `chat-history-store.previewLastMessages`, which retains the
   * trailing message of every history key the user has opened
   * (capped at 100). Empty when there's no preview, when history has
   * already resolved, or when a stream has already started writing.
   * `ChatPanel` consumes this to bypass the cold-load reveal cycle in
   * the bridged case — see `shouldArmColdLoad` in
   * `features/chat-ui/ChatPanel/ChatPanel.tsx`.
   */
  bridgeMessages: DisplaySessionEvent[];
}

const EMPTY_BRIDGE: DisplaySessionEvent[] = [];

/**
 * Single-frame projection of the chat transcript from the persisted
 * history snapshot and the live stream events into the canonical
 * ordered `messages` array consumed by `ChatPanel`/`ChatMessageList`.
 *
 * Phase B of the bottoms-up refactor reduced this from a 525-line merge
 * with anchor rules + a `reinstateMissingPersistedOnSend` backstop +
 * a `lastNonEmptyRef` empty-frame cache to a thin call into the pure
 * `projectConversation` projector. The hacks went away because the
 * upstream stream handlers now stamp every message with a stable
 * `clientId` (see `attachment-helpers.buildUserChatMessage` and
 * `stream/handlers/lifecycle.handleEventSaved`), so React keys stay
 * pinned across the placeholder -> persisted-id swap and the merge
 * never has to chase an inconsistent id.
 *
 * The `setThread` effect still bridges history into the message-store
 * for the older snapshot consumers (`use-load-older-messages`,
 * `useOnboardingTaskWatcher`); the projector itself has no dependency
 * on the message-store and reads `historyMessages` directly.
 */
export function useConversationSnapshot({
  streamKey,
  transcriptKey,
  historyMessages,
}: UseConversationSnapshotOptions): UseConversationSnapshotResult {
  useEffect(() => {
    if (historyMessages && historyMessages.length > 0) {
      useMessageStore.getState().setThread(transcriptKey, historyMessages);
    }
  }, [transcriptKey, historyMessages]);

  const streamMessages = useStreamEvents(streamKey);

  // Registry of persisted event_id -> on-screen clientId, recorded by the
  // projector when a history row supersedes a stream row. Keeping it here
  // (instead of deriving from the stream every projection) means the React
  // keys of just-persisted bubbles stay stable even after the caught-up
  // clear path empties the stream store — otherwise the just-sent user
  // bubble would remount (visible flash/jump) when its temp- row drops.
  // Keyed per transcript so switching threads starts a fresh registry.
  const clientIdAliases = useMemo(
    () => new Map<string, string>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- transcriptKey intentionally resets the registry
    [transcriptKey],
  );

  const messages = useMemo(
    () => projectConversation(historyMessages ?? [], streamMessages, clientIdAliases),
    [historyMessages, streamMessages, clientIdAliases],
  );

  // Read the trailing-message preview the chat-history-store carries
  // for this key (the cache hits on every navigation back to a
  // session the user has opened before, even after the LRU evicted
  // the full transcript entry). `useShallow` keeps re-renders bounded
  // to actual preview-message identity changes for this one key.
  const previewBridge = useChatHistoryStore(
    useShallow((s) => {
      const preview = s.previewLastMessages[transcriptKey];
      return preview ? [preview] : EMPTY_BRIDGE;
    }),
  );

  const bridgeMessages = useMemo(() => {
    // The bridge is purely a "show something while we wait" affordance.
    // The moment we have any real or live data, the panel renders that
    // instead and the bridge collapses back to empty.
    if (messages.length > 0) return EMPTY_BRIDGE;
    return previewBridge;
  }, [messages, previewBridge]);

  return { messages, bridgeMessages };
}
