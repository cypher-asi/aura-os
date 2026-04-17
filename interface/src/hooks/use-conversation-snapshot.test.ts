import { renderHook } from "@testing-library/react";
import type { DisplaySessionEvent } from "../types/stream";
import { useMessageStore } from "../stores/message-store";
import { createSetters, streamMetaMap, useStreamStore } from "./stream/store";
import { useConversationSnapshot } from "./use-conversation-snapshot";
import {
  addPendingChatMessage,
  clearPendingChatMessages,
} from "../lib/pending-chat-messages";

function setStreamMessages(streamKey: string, messages: DisplaySessionEvent[]) {
  useStreamStore.setState((state) => ({
    entries: {
      ...state.entries,
      [streamKey]: {
        isStreaming: false,
        events: [],
        streamingText: "",
        thinkingText: "",
        thinkingDurationMs: null,
        activeToolCalls: [],
        timeline: [],
        progressText: "",
      },
    },
  }));
  createSetters(streamKey).setEvents(messages);
}

describe("useConversationSnapshot", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    useMessageStore.setState({ messages: {}, orderedIds: {} });
    window.sessionStorage.clear();
  });

  it("deduplicates persisted user messages against temp stream messages", () => {
    const streamKey = "thread-1";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user", role: "user", content: "Testing" },
      { id: "evt-assistant", role: "assistant", content: "Meow!" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "Testing" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, historyMessages),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });

  it("deduplicates persisted assistant messages against stream placeholders", () => {
    const streamKey = "thread-2";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-assistant", role: "assistant", content: "Meow!" },
    ];

    setStreamMessages(streamKey, [
      { id: "stream-1", role: "assistant", content: "Meow!" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, historyMessages),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });

  it("prefers fresher persisted history over a stale stored thread snapshot", () => {
    const streamKey = "thread-3";
    const staleStoredMessages: DisplaySessionEvent[] = [
      { id: "evt-user-1", role: "user", content: "hi" },
      { id: "evt-assistant-1", role: "assistant", content: "hello" },
    ];
    const historyMessages: DisplaySessionEvent[] = [
      ...staleStoredMessages,
      { id: "evt-user-2", role: "user", content: "create a spec for me?" },
      { id: "evt-assistant-2", role: "assistant", content: "Absolutely — I can create a spec." },
    ];

    useMessageStore.getState().setThread(streamKey, staleStoredMessages);

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, historyMessages),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });

  it("includes pending local user messages on refresh before the backend acknowledges them", () => {
    const streamKey = "thread-4";
    const pendingMessage: DisplaySessionEvent = {
      id: "temp-1",
      role: "user",
      content: "last failed message",
    };

    addPendingChatMessage(streamKey, pendingMessage);

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, []),
    );

    expect(result.current.messages).toEqual([pendingMessage]);

    clearPendingChatMessages(streamKey);
  });

  it("deduplicates pending local user messages once persisted history catches up", () => {
    const streamKey = "thread-5";
    const pendingMessage: DisplaySessionEvent = {
      id: "temp-2",
      role: "user",
      content: "same text",
    };
    const persistedMessage: DisplaySessionEvent = {
      id: "evt-user-3",
      role: "user",
      content: "same text",
    };

    addPendingChatMessage(streamKey, pendingMessage);

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, [persistedMessage]),
    );

    expect(result.current.messages).toEqual([persistedMessage]);
  });
});
