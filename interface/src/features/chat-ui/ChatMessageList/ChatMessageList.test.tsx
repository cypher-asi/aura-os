import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "./ChatMessageList";
import type { DisplaySessionEvent } from "../../../shared/types/stream";

function makeMessage(
  id: string,
  content: string,
  role: DisplaySessionEvent["role"] = "assistant",
  clientId?: string,
): DisplaySessionEvent {
  return { id, clientId: clientId ?? id, role, content } as DisplaySessionEvent;
}

const mockMessageBubble = vi.fn();
const mockStreamEntry = {
  isStreaming: false,
  streamingText: "",
  thinkingText: "",
  thinkingDurationMs: null as number | null,
  activeToolCalls: [],
  timeline: [],
  progressText: "",
};

vi.mock("../../../apps/chat/components/MessageBubble", () => ({
  MessageBubble: (props: { message: { id: string } }) => {
    mockMessageBubble(props);
    return <div data-testid={`bubble-${props.message.id}`} />;
  },
}));

vi.mock("../../../apps/chat/components/StreamingBubble", () => ({
  StreamingBubble: () => <div data-testid="streaming-bubble" />,
}));

vi.mock("../../../hooks/stream/store", () => ({
  useStreamStore: (selector: (state: unknown) => unknown) =>
    selector({
      entries: {
        "stream-1": mockStreamEntry,
      },
    }),
}));

function makeScrollRef(overrides: { scrollHeight?: number; scrollTop?: number } = {}) {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    scrollHeight: {
      value: overrides.scrollHeight ?? 800,
      writable: true,
      configurable: true,
    },
    scrollTop: {
      value: overrides.scrollTop ?? 0,
      writable: true,
      configurable: true,
    },
  });
  return { current: el };
}

describe("ChatMessageList", () => {
  beforeEach(() => {
    mockMessageBubble.mockReset();
    Object.assign(mockStreamEntry, {
      isStreaming: false,
      streamingText: "",
      thinkingText: "",
      thinkingDurationMs: null,
      activeToolCalls: [],
      timeline: [],
      progressText: "",
    });
  });

  it("renders historical bubbles with default collapse state for activity rows", () => {
    const scrollRef = makeScrollRef();

    render(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hello"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    expect(mockMessageBubble).toHaveBeenCalledTimes(1);
    expect(mockMessageBubble.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        message: expect.objectContaining({ id: "message-1" }),
        isStreaming: false,
        initialActivitiesExpanded: false,
      }),
    );
  });

  it("renders an empty-state node when there are no messages and no streaming content", () => {
    const scrollRef = makeScrollRef();

    render(
      <ChatMessageList
        messages={[]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        emptyState={<div data-testid="empty">Start chatting.</div>}
      />,
    );

    expect(screen.getByTestId("empty")).toBeInTheDocument();
    expect(mockMessageBubble).not.toHaveBeenCalled();
  });

  it("signals onInitialAnchorReady once the first messages render", () => {
    const scrollRef = makeScrollRef();
    const onInitialAnchorReady = vi.fn();

    const { rerender } = render(
      <ChatMessageList
        messages={[]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        onInitialAnchorReady={onInitialAnchorReady}
      />,
    );

    expect(onInitialAnchorReady).not.toHaveBeenCalled();

    rerender(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hello"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        onInitialAnchorReady={onInitialAnchorReady}
      />,
    );

    expect(onInitialAnchorReady).toHaveBeenCalledTimes(1);
  });

  it("pins the scroll container to the bottom when messages arrive while auto-following", () => {
    const scrollRef = makeScrollRef({ scrollHeight: 800, scrollTop: 0 });

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hi"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        isAutoFollowing
      />,
    );

    expect(scrollRef.current.scrollTop).toBe(800);

    (scrollRef.current as unknown as { scrollHeight: number }).scrollHeight = 1200;

    rerender(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hi"),
          makeMessage("message-2", "Hello again"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        isAutoFollowing
      />,
    );

    expect(scrollRef.current.scrollTop).toBe(1200);
  });

  it("does not pin to bottom when auto-following is off", () => {
    const scrollRef = makeScrollRef({ scrollHeight: 800, scrollTop: 100 });

    render(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hi"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        isAutoFollowing={false}
      />,
    );

    expect(scrollRef.current.scrollTop).toBe(100);
  });

  it("does not pin to bottom when getUserUnpinnedAt returns a non-zero timestamp, even while still 'auto-following'", () => {
    // Simulates the same-tick race: a streaming token causes a re-render
    // while the user has already fired a wheel event, but the React state
    // for `isAutoFollowing` hasn't flushed yet. The defense-in-depth check
    // on `getUserUnpinnedAt` must short-circuit the tail-pin write.
    const scrollRef = makeScrollRef({ scrollHeight: 800, scrollTop: 100 });

    render(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hi"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        isAutoFollowing
        getUserUnpinnedAt={() => 12345}
      />,
    );

    expect(scrollRef.current.scrollTop).toBe(100);
  });

  it("shows a Load older trigger when older history is available", () => {
    const scrollRef = makeScrollRef();
    const onLoadOlder = vi.fn();

    render(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hi"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        hasOlderMessages
        onLoadOlder={onLoadOlder}
      />,
    );

    expect(screen.getByRole("button", { name: "Load older messages" })).toBeInTheDocument();
  });

  it("keeps the scroll pinned when streaming text grows while auto-following", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.streamingText = "partial output";
    const scrollRef = makeScrollRef({ scrollHeight: 800, scrollTop: 800 });

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hi"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        isAutoFollowing
      />,
    );

    mockStreamEntry.streamingText = "partial output with many more tokens";
    (scrollRef.current as unknown as { scrollHeight: number }).scrollHeight = 1000;

    act(() => {
      rerender(
        <ChatMessageList
          messages={[
            makeMessage("message-1", "Hi"),
          ]}
          streamKey="stream-1"
          scrollRef={scrollRef}
          isAutoFollowing
        />,
      );
    });

    expect(scrollRef.current.scrollTop).toBe(1000);
  });

  it("does not render the trailing assistant message twice while live text is streaming", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.streamingText = "partial output";
    const scrollRef = makeScrollRef();

    render(
      <ChatMessageList
        messages={[
          makeMessage("temp-user", "testing", "user"),
          makeMessage("stream-assistant", "partial output"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    expect(screen.getByTestId("bubble-temp-user")).toBeInTheDocument();
    expect(screen.queryByTestId("bubble-stream-assistant")).not.toBeInTheDocument();
    expect(screen.getByTestId("streaming-bubble")).toBeInTheDocument();
  });

  it("keeps the streaming bubble mounted as streaming text grows", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.streamingText = "partial output";
    const scrollRef = makeScrollRef();

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("temp-user", "testing", "user"),
          makeMessage("stream-assistant", "partial output"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const initialStreamingBubble = screen.getByTestId("streaming-bubble");

    mockStreamEntry.streamingText = "partial output plus more tokens";
    rerender(
      <ChatMessageList
        messages={[
          makeMessage("temp-user", "testing", "user"),
          makeMessage("stream-assistant", "partial output"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    expect(screen.getByTestId("streaming-bubble")).toBe(initialStreamingBubble);
    expect(screen.queryByTestId("bubble-stream-assistant")).not.toBeInTheDocument();
  });

  it("expands activities on the just-finalized message when a stream ends", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.streamingText = "partial output";

    const scrollRef = makeScrollRef();

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hi"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    mockMessageBubble.mockClear();
    Object.assign(mockStreamEntry, {
      isStreaming: false,
      streamingText: "",
    });

    rerender(
      <ChatMessageList
        messages={[
          makeMessage("message-1", "Hi"),
          makeMessage("message-2", "Final"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const finalizedCall = mockMessageBubble.mock.calls.find(
      (call) => call[0].message.id === "message-2",
    );
    expect(finalizedCall?.[0]).toEqual(
      expect.objectContaining({
        initialActivitiesExpanded: true,
      }),
    );

    const historicalCall = mockMessageBubble.mock.calls.find(
      (call) => call[0].message.id === "message-1",
    );
    expect(historicalCall?.[0]).toEqual(
      expect.objectContaining({
        initialActivitiesExpanded: false,
      }),
    );
  });

  it("does not remount the tail assistant bubble when persisted history replaces the stream placeholder", () => {
    const scrollRef = makeScrollRef();

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("temp-user", "testing", "user"),
          // The stream lifecycle handler stamps a stable `clientId` on
          // the assistant placeholder; `mergeSavedAssistantMessage`
          // preserves it when `id` swaps to the persisted `event_id`.
          makeMessage("stream-assistant", "Final answer", "assistant", "stream-assistant"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const placeholderWrapper =
      screen.getByTestId("bubble-stream-assistant").parentElement;
    expect(placeholderWrapper).not.toBeNull();

    rerender(
      <ChatMessageList
        messages={[
          makeMessage("message-user", "testing", "user", "temp-user"),
          // Same `clientId` as the placeholder above: React keeps the
          // bubble's identity across the persisted-id swap.
          makeMessage("message-assistant", "Final answer", "assistant", "stream-assistant"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const persistedWrapper =
      screen.getByTestId("bubble-message-assistant").parentElement;
    expect(persistedWrapper).toBe(placeholderWrapper);
  });

  // Regression test for the "just-sent user bubble flashes/jumps right
  // after send" report. The optimistic `temp-...` user row is replaced
  // by the persisted history row when the refetch lands; the projector
  // (`conversation-projector`) carries the temp row's `clientId` onto
  // the persisted row, so React must keep the bubble's DOM node alive
  // across the swap instead of unmounting + remounting it.
  it("does not remount the just-sent user bubble when persisted history replaces the optimistic temp- row", () => {
    const scrollRef = makeScrollRef();

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("temp-user-1", "first prompt", "user", "temp-user-1"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const optimisticWrapper =
      screen.getByTestId("bubble-temp-user-1").parentElement;
    expect(optimisticWrapper).not.toBeNull();

    rerender(
      <ChatMessageList
        messages={[
          // Persisted row from history, with the optimistic row's
          // clientId carried over by the projector alias registry.
          makeMessage("evt-user-1", "first prompt", "user", "temp-user-1"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const persistedWrapper =
      screen.getByTestId("bubble-evt-user-1").parentElement;
    expect(persistedWrapper).toBe(optimisticWrapper);
  });

  // Regression test for the "previous assistant flickers when I send a
  // new message" report. The old position-based "assistant-tail" key
  // changed from "assistant-tail" -> a_old.id the moment a new user
  // bubble was appended, forcing React to unmount + remount the prior
  // assistant. With the id-alias keying strategy the prior assistant's
  // DOM node must survive the append.
  it("does not remount the prior assistant bubble when a new user message is appended", () => {
    const scrollRef = makeScrollRef();

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("user-old", "earlier prompt", "user"),
          makeMessage("assistant-old", "earlier answer"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const priorAssistantWrapper =
      screen.getByTestId("bubble-assistant-old").parentElement;
    expect(priorAssistantWrapper).not.toBeNull();

    rerender(
      <ChatMessageList
        messages={[
          makeMessage("user-old", "earlier prompt", "user"),
          makeMessage("assistant-old", "earlier answer"),
          makeMessage("temp-user-new", "follow-up prompt", "user"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const afterAppendWrapper =
      screen.getByTestId("bubble-assistant-old").parentElement;
    expect(afterAppendWrapper).toBe(priorAssistantWrapper);
  });

  // Regression test for the "previous assistant overwrites the new
  // user message slot, then reappears at end of turn" report. The
  // user-side trigger is `core.setEvents((p) => [...p, userMsg])`
  // appending a temp-user bubble in the same render the prior
  // assistant's id is still flipping from `stream-...` to its
  // persisted event id. With the stable `clientId` strategy
  // (`mergeSavedAssistantMessage` preserves the placeholder's
  // `clientId` across the persisted-id swap), React keeps the prior
  // assistant's bubble identity even when its `msg.id` changes.
  it("keeps the prior assistant bubble identity when its id swaps at the same tick a new user message is appended", () => {
    const scrollRef = makeScrollRef();

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("user-old", "earlier prompt", "user"),
          makeMessage("stream-assistant-old", "earlier answer", "assistant", "stream-assistant-old"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const priorAssistantWrapper =
      screen.getByTestId("bubble-stream-assistant-old").parentElement;
    expect(priorAssistantWrapper).not.toBeNull();

    rerender(
      <ChatMessageList
        messages={[
          makeMessage("user-old", "earlier prompt", "user"),
          // Same `clientId` as before — `mergeSavedAssistantMessage`
          // preserves it across the placeholder -> persisted-id swap.
          makeMessage(
            "persisted-assistant-old",
            "earlier answer",
            "assistant",
            "stream-assistant-old",
          ),
          // ...landing in the same render as the user pressing Send.
          makeMessage("temp-user-new", "follow-up prompt", "user"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const afterAppendWrapper =
      screen.getByTestId("bubble-persisted-assistant-old").parentElement;
    expect(afterAppendWrapper).toBe(priorAssistantWrapper);
  });

  // Negative case: the alias walk must terminate at the first
  // non-matching pair from the tail. Two unrelated assistants with
  // different content sitting at the same tail index across renders
  // should NOT be aliased together — that would silently reuse one
  // bubble's React node for an entirely different message.
  it("does not alias unrelated trailing assistants with different content", () => {
    const scrollRef = makeScrollRef();

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("user-a", "first prompt", "user"),
          makeMessage("assistant-a", "first answer"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const firstWrapper =
      screen.getByTestId("bubble-assistant-a").parentElement;
    expect(firstWrapper).not.toBeNull();

    rerender(
      <ChatMessageList
        messages={[
          makeMessage("user-a", "first prompt", "user"),
          makeMessage("assistant-b", "completely different answer"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    expect(screen.queryByTestId("bubble-assistant-a")).not.toBeInTheDocument();
    const secondWrapper =
      screen.getByTestId("bubble-assistant-b").parentElement;
    expect(secondWrapper).not.toBe(firstWrapper);
  });

  // Switching to a different chat must drop accumulated aliases.
  // Otherwise an alias recorded for stream-1 would silently apply to a
  // colliding id in stream-2 and the new chat would render a stale
  // bubble identity.
  it("resets id aliases when streamKey changes", () => {
    const scrollRef = makeScrollRef();

    const { rerender } = render(
      <ChatMessageList
        messages={[
          makeMessage("temp-user", "testing", "user"),
          makeMessage("stream-assistant", "Final answer"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    rerender(
      <ChatMessageList
        messages={[
          makeMessage("message-user", "testing", "user"),
          makeMessage("message-assistant", "Final answer"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const persistedWrapper =
      screen.getByTestId("bubble-message-assistant").parentElement;

    rerender(
      <ChatMessageList
        messages={[
          makeMessage("other-user", "different chat", "user"),
          makeMessage("other-assistant", "different reply"),
        ]}
        streamKey="stream-2"
        scrollRef={scrollRef}
      />,
    );

    const newChatWrapper =
      screen.getByTestId("bubble-other-assistant").parentElement;
    expect(newChatWrapper).not.toBe(persistedWrapper);
  });
});
