import { useState, useCallback, useRef } from "react";
import { agentTemplatesApi } from "../api/agents";
import { buildDisplayEvents } from "../utils/build-display-messages";
import { useMessageStore } from "../stores/message-store";
import { useChatViewStore, useThreadView } from "../stores/chat-view-store";
import type { AnchorInfo } from "./use-scroll-anchor-v2";

interface UseLoadOlderMessagesOptions {
  threadKey: string;
  agentId?: string;
  captureAnchor: () => AnchorInfo | null;
  restoreAnchor: (anchor: AnchorInfo) => void;
}

interface UseLoadOlderMessagesReturn {
  loadOlder: () => Promise<void>;
  isLoadingOlder: boolean;
  hasOlderMessages: boolean;
}

export function useLoadOlderMessages({
  threadKey,
  agentId,
  captureAnchor,
  restoreAnchor,
}: UseLoadOlderMessagesOptions): UseLoadOlderMessagesReturn {
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const loadingRef = useRef(false);
  const { hasOlderMessages } = useThreadView(threadKey);

  const loadOlder = useCallback(async () => {
    if (!agentId || loadingRef.current) return;
    loadingRef.current = true;
    setIsLoadingOlder(true);

    try {
      const anchor = captureAnchor();
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

      if (anchor) {
        requestAnimationFrame(() => restoreAnchor(anchor));
      }
    } finally {
      loadingRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [agentId, threadKey, captureAnchor, restoreAnchor]);

  return { loadOlder, isLoadingOlder, hasOlderMessages };
}
