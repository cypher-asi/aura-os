import { renderHook } from "@testing-library/react";
import type { DisplaySessionEvent } from "../shared/types/stream";
import { useMessageStore } from "../stores/message-store";
import { createSetters, streamMetaMap, useStreamStore } from "./stream/store";
import { useConversationSnapshot } from "./use-conversation-snapshot";

function setStreamMessages(streamKey: string, messages: DisplaySessionEvent[]) {
  useStreamStore.setState((state) => ({
    entries: {
      ...state.entries,
      [streamKey]: {
        isStreaming: false,
        isWriting: false,
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

function setLiveAssistantText(streamKey: string, streamingText: string) {
  useStreamStore.setState((state) => ({
    entries: {
      ...state.entries,
      [streamKey]: {
        ...(state.entries[streamKey] ?? {
          isStreaming: false,
          isWriting: false,
          events: [],
          thinkingDurationMs: null,
          activeToolCalls: [],
          timeline: [],
          progressText: "",
        }),
        streamingText,
        thinkingText: "",
        isWriting: false,
      },
    },
  }));
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

  it("deduplicates a lone optimistic user when history already has the active assistant tail", () => {
    const streamKey = "thread-live-tail";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-real", role: "user", content: "test" },
      {
        id: "evt-assistant-real",
        role: "assistant",
        content: "Hello! It looks like you're just testing things out.",
      },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-repeat", role: "user", content: "test" },
    ]);
    setLiveAssistantText(
      streamKey,
      "Hello! It looks like you're just testing things out.",
    );

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, historyMessages),
    );

    expect(result.current.messages).toEqual(historyMessages);
  });

  it("keeps a repeated optimistic prompt when the matching history tail is not live", () => {
    const streamKey = "thread-repeat-no-live-tail";
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

  it("anchors the leading optimistic user bubble against history when the assistant content has not converged yet", () => {
    // Regression for the "user prompt remains, all assistant content gone"
    // bug: when the stream still holds [user-temp, asst-stream] and the
    // forced post-stream history fetch returns [user-real, asst-real]
    // whose assistant content is *fuller* than the stream (e.g. because
    // the stream was paused mid-token, or final post-processing replaced
    // it), tail-matching fails on the assistant slot. The back-walk path
    // must still anchor the user at stored[0] so the user message
    // doesn't get duplicated at the bottom while the assistant gets
    // dropped.
    const streamKey = "thread-anchor";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-real", role: "user", content: "Hi" },
      { id: "evt-assistant-real", role: "assistant", content: "Meow!" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "Hi" },
      { id: "stream-1", role: "assistant", content: "Meo" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, historyMessages),
    );

    expect(result.current.messages.map((m) => m.id)).toEqual([
      "evt-user-real",
      "evt-assistant-real",
      "stream-1",
    ]);
    expect(
      result.current.messages.filter((m) => m.role === "user"),
    ).toHaveLength(1);
  });

  it("aligns [user-temp, asst-stream] with [user-real, asst-real] when assistant content matches", () => {
    const streamKey = "thread-anchor-clean";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user-real", role: "user", content: "Hi" },
      { id: "evt-assistant-real", role: "assistant", content: "Meow!" },
    ];

    setStreamMessages(streamKey, [
      { id: "temp-1", role: "user", content: "Hi" },
      { id: "stream-1", role: "assistant", content: "Meow!" },
    ]);

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, historyMessages),
    );

    expect(result.current.messages).toEqual(historyMessages);
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

  it("falls back to the last non-empty snapshot when every input briefly empties on the same stream", () => {
    // Regression for the CEO chat blink: a sidebar prefetch evicts the
    // active history entry (`MAX_HISTORY_ENTRIES = 8`), the post-stream
    // "history caught up" effect resets stream events to `[]`, and the
    // `setThread(streamKey, history)` effect hasn't re-run yet because
    // `historyMessages` is also `[]` from the eviction. Without the
    // fallback, the merged result is `[]` and `ChatMessageList` flashes
    // its empty state, dropping the entire transcript for one or two
    // frames mid-turn. The fallback keeps the prior transcript visible
    // until any input repopulates.
    const streamKey = "thread-blink";
    const historyMessages: DisplaySessionEvent[] = [
      { id: "evt-user", role: "user", content: "hello" },
      { id: "evt-assistant", role: "assistant", content: "hi there" },
    ];

    const { result, rerender } = renderHook(
      ({ history }: { history: DisplaySessionEvent[] | undefined }) =>
        useConversationSnapshot(streamKey, history),
      { initialProps: { history: historyMessages } },
    );

    expect(result.current.messages).toEqual(historyMessages);

    // Simulate the eviction + stream reset round-trip: history briefly
    // empties, message-store thread for `streamKey` is intentionally
    // cleared too so the inline `getThreadMessages` read inside
    // `useMemo` cannot rescue the snapshot from the message store.
    useMessageStore.getState().clearThread(streamKey);
    setStreamMessages(streamKey, []);
    rerender({ history: [] });

    expect(result.current.messages).toEqual(historyMessages);

    // Recovery: history refetch lands. The fallback should release back
    // to the live merged result for the new input — verified by passing a
    // distinct payload so we know we're not just returning the cache.
    const recoveredHistory: DisplaySessionEvent[] = [
      ...historyMessages,
      { id: "evt-user-2", role: "user", content: "still here" },
    ];
    rerender({ history: recoveredHistory });

    expect(result.current.messages).toEqual(recoveredHistory);
  });

  it("returns a legitimately-empty thread for a brand-new chat with no prior snapshot", () => {
    // The fallback must NOT invent messages for a chat that has never
    // had any. Initial mount with empty inputs must render as truly empty
    // so the cold-load empty state can show.
    const streamKey = "thread-fresh";

    const { result } = renderHook(() =>
      useConversationSnapshot(streamKey, []),
    );

    expect(result.current.messages).toEqual([]);
  });

  it("clears the fallback cache when the chat switches to a new streamKey", () => {
    // Switching agents must reset the cache so the new chat's empty
    // initial frame is not papered over by the previous chat's tail.
    const firstHistory: DisplaySessionEvent[] = [
      { id: "evt-user-a", role: "user", content: "first" },
      { id: "evt-assistant-a", role: "assistant", content: "reply A" },
    ];

    const { result, rerender } = renderHook(
      ({ key, history }: { key: string; history: DisplaySessionEvent[] }) =>
        useConversationSnapshot(key, history),
      { initialProps: { key: "thread-a", history: firstHistory } },
    );

    expect(result.current.messages).toEqual(firstHistory);

    rerender({ key: "thread-b", history: [] });

    // The new chat starts empty even though the previous one had content.
    expect(result.current.messages).toEqual([]);
  });
});
