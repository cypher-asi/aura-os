import { createContext, useContext } from "react";

export interface ChatResizeSessionState {
  isActive: boolean;
  settledAt: number;
}

const DEFAULT_CHAT_RESIZE_SESSION: ChatResizeSessionState = {
  isActive: false,
  settledAt: 0,
};

export const ChatResizeSessionContext = createContext<ChatResizeSessionState>(
  DEFAULT_CHAT_RESIZE_SESSION,
);

export function useChatResizeSession(): ChatResizeSessionState {
  return useContext(ChatResizeSessionContext);
}
