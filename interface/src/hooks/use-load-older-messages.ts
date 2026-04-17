import { useState, useCallback, useRef } from "react";
import { agentTemplatesApi } from "../api/agents";
import { buildDisplayEvents } from "../utils/build-display-messages";
import { useMessageStore } from "../stores/message-store";
import { useChatViewStore, useThreadView } from "../stores/chat-view-store";

interface UseLoadOlderMessagesOptions {
  threadKey: string;
  agentId?: string;
}

interface UseLoadOlderMessagesReturn {
  loadOlder: () => Promise<void>;
  isLoadingOlder: boolean;
  hasOlderMessages: boolean;
}

/**
 * Loads an older page of history and prepends it to the thread. Reading
 * position is preserved by the browser via CSS `overflow-anchor` on the
 * scroll container — when content is inserted above the viewport the browser
 * shifts `scrollTop` by the delta automatically, so no JS anchor capture /
 * restore is needed.
 */
export function useLoadOlderMessages({
  threadKey,
  agentId,
}: UseLoadOlderMessagesOptions): UseLoadOlderMessagesReturn {
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const loadingRef = useRef(false);
  const { hasOlderMessages } = useThreadView(threadKey);

  const loadOlder = useCallback(async () => {
    if (!agentId || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoadingOlder(true);

    try {
      const orderedIds = useMessageStore.getState().orderedIds[threadKey];
      const oldestId = orderedIds?.[0];
      if (!oldestId) return;

      const response = await agentTemplatesApi.listEventsPaginated(agentId, {
        before: oldestId,
        limit: 50,
      });

      const displayEvents = buildDisplayEvents(response.events);
      if (displayEvents.length > 0) {
        useMessageStore.getState().prependMessages(threadKey, displayEvents);
      }

      useChatViewStore.getState().setHasOlderMessages(threadKey, response.has_more);
      if (response.next_cursor) {
        useChatViewStore.getState().setOlderCursor(threadKey, response.next_cursor);
      }
    } finally {
      loadingRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [agentId, threadKey]);

  return { loadOlder, isLoadingOlder, hasOlderMessages };
}
