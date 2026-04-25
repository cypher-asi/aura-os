import { queryOptions } from "@tanstack/react-query";
import { buildDisplayEvents } from "../utils/build-display-messages";
import type { SessionEvent } from "../shared/types";
import type { DisplaySessionEvent } from "../shared/types/stream";

export interface ChatHistoryData {
  events: DisplaySessionEvent[];
  lastMessageAt: string | null;
}

export const CHAT_HISTORY_STALE_TIME_MS = 30_000;

export const chatHistoryQueryKeys = {
  history: (historyKey: string) => ["chat-history", historyKey] as const,
};

export function chatHistoryQueryOptions(
  historyKey: string,
  fetchFn: () => Promise<SessionEvent[]>,
) {
  return queryOptions({
    queryKey: chatHistoryQueryKeys.history(historyKey),
    queryFn: async (): Promise<ChatHistoryData> => {
      const raw = await fetchFn();
      return {
        events: buildDisplayEvents(raw),
        lastMessageAt: raw.length > 0 ? raw[raw.length - 1].created_at : null,
      };
    },
    staleTime: CHAT_HISTORY_STALE_TIME_MS,
  });
}
