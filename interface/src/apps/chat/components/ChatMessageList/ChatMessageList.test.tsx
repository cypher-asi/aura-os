import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "./ChatMessageList";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";

function makeMessage(id: string, content: string, role: DisplaySessionEvent["role"] = "assistant"): DisplaySessionEvent {
  return { id, role, content } as DisplaySessionEvent;
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

vi.mock("../MessageBubble", () => ({
  MessageBubble: (props: { message: { id: string } }) => {
    mockMessageBubble(props);
    return <div data-testid={`bubble-${props.message.id}`} />;
  },
}));

vi.mock("../StreamingBubble", () => ({
  StreamingBubble: () => <div data-testid="streaming-bubble" />,
}));

vi.mock("../../../../hooks/stream/store", () => ({
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

  it("renders historical bubbles with default collapse state for thinking/activity", () => {
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
        initialThinkingExpanded: false,
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

  it("expands thinking / activities on the just-finalized message when a stream ends", () => {
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
        initialThinkingExpanded: true,
        initialActivitiesExpanded: true,
      }),
    );

    const historicalCall = mockMessageBubble.mock.calls.find(
      (call) => call[0].message.id === "message-1",
    );
    expect(historicalCall?.[0]).toEqual(
      expect.objectContaining({
        initialThinkingExpanded: false,
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
          makeMessage("stream-assistant", "Final answer"),
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
          makeMessage("message-user", "testing", "user"),
          makeMessage("message-assistant", "Final answer"),
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
      />,
    );

    const persistedWrapper =
      screen.getByTestId("bubble-message-assistant").parentElement;
    expect(persistedWrapper).toBe(placeholderWrapper);
  });
});
