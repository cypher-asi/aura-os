import { renderHook } from "@testing-library/react";
import type { DisplaySessionEvent } from "../types/stream";
import { useMessageStore } from "../stores/message-store";
import { createSetters, streamMetaMap, useStreamStore } from "./stream/store";
import { useConversationSnapshot } from "./use-conversation-snapshot";

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
  });

  it("deduplicates persisted user messages once the saved assistant has anchored the turn", () => {
    const streamKey = "thread-1";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user", role: "user", content: "Testing" },
      { id: "evt-assistant", role: "assistant", content: "Meow!" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "Testing" },
      { id: "evt-assistant", role: "assistant", content: "Meow!" },
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

  it("still renders a fresh optimistic bubble when identical content exists earlier in history", () => {
    const streamKey = "thread-3";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-old", role: "user", content: "test" },
      { id: "evt-assistant-old", role: "assistant", content: "prior reply" },
    ];

    const optimisticUser: DisplaySessionEvent = {
      id: "temp-repeat",
      role: "user",
      content: "test",
    };
    setStreamMessages(streamKey, [optimisticUser]);

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, historyMessages),
    );

    expect(result.current.messages).toEqual([...historyMessages, optimisticUser]);
  });

  it("dedupes the full turn once the tail of history sequence-matches the stream", () => {
    const streamKey = "thread-4";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-old", role: "user", content: "test" },
      { id: "evt-assistant-old", role: "assistant", content: "prior reply" },
      { id: "evt-user-new", role: "user", content: "test" },
      { id: "evt-assistant-new", role: "assistant", content: "fresh reply" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-repeat", role: "user", content: "test" },
      { id: "stream-reply", role: "assistant", content: "fresh reply" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, historyMessages),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });
});
