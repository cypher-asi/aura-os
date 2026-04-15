import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatMessageList } from "./ChatMessageList";
import type { MessageHeightCache } from "../../hooks/use-message-height-cache";
import { ChatResizeSessionContext } from "../ChatPanel/chat-resize-session-context";

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
let mockVirtualItems = [
  {
    key: "row-0",
    index: 0,
    start: 0,
  },
];
let mockTotalSize = 100;
const mockMeasureElement = vi.fn();
const mockMeasure = vi.fn();
let nextStreamingBubbleHeight = 0;

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  private readonly callback: ResizeObserverCallback;
  private readonly elements = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe = (element: Element) => {
    this.elements.add(element);
  };

  unobserve = (element: Element) => {
    this.elements.delete(element);
  };

  disconnect = () => {
    this.elements.clear();
  };

  static reset() {
    MockResizeObserver.instances = [];
  }

  static trigger(element: Element) {
    for (const instance of MockResizeObserver.instances) {
      if (instance.elements.has(element)) {
        instance.callback([], instance as unknown as ResizeObserver);
      }
    }
  }
}

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => mockVirtualItems.slice(0, count),
    getTotalSize: () => mockTotalSize,
    measureElement: mockMeasureElement,
    measure: mockMeasure,
  }),
}));

vi.mock("../MessageBubble", () => ({
  MessageBubble: (props: { message: { id: string } }) => {
    mockMessageBubble(props);
    return <div data-testid={`bubble-${props.message.id}`} />;
  },
}));

vi.mock("../StreamingBubble", () => ({
  StreamingBubble: () => <div data-testid="streaming-bubble" />,
}));

vi.mock("../../hooks/stream/store", () => ({
  useStreamStore: (selector: (state: unknown) => unknown) =>
    selector({
      entries: {
        "stream-1": mockStreamEntry,
      },
    }),
}));

describe("ChatMessageList", () => {
  const originalResizeObserver = global.ResizeObserver;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  const heightCache: MessageHeightCache = {
    getHeight: vi.fn(() => undefined),
    setHeight: vi.fn(),
    estimateHeight: vi.fn(() => 120),
  };

  beforeEach(() => {
    mockMessageBubble.mockReset();
    mockMeasureElement.mockReset();
    mockMeasure.mockReset();
    MockResizeObserver.reset();
    nextStreamingBubbleHeight = 0;
    Object.assign(mockStreamEntry, {
      isStreaming: false,
      streamingText: "",
      thinkingText: "",
      thinkingDurationMs: null,
      activeToolCalls: [],
      timeline: [],
      progressText: "",
    });
    vi.mocked(heightCache.getHeight).mockClear();
    vi.mocked(heightCache.setHeight).mockClear();
    vi.mocked(heightCache.estimateHeight).mockClear();
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    requestAnimationFrameSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    mockVirtualItems = [
      {
        key: "row-0",
        index: 0,
        start: 0,
      },
      {
        key: "row-1",
        index: 1,
        start: 100,
      },
    ];
    mockTotalSize = 200;
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    requestAnimationFrameSpy.mockRestore();
  });

  it("renders historical bubbles without passing an initial fade-in prop", () => {
    const scrollRef = { current: document.createElement("div") };

    render(
      <ChatMessageList
        messages={[
          {
            id: "message-1",
            role: "assistant",
            content: "Hello",
          } as any,
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        heightCache={heightCache}
      />,
    );

    expect(mockMessageBubble).toHaveBeenCalledTimes(1);
    expect(mockMessageBubble.mock.calls[0][0]).toEqual({
      message: expect.objectContaining({
        id: "message-1",
      }),
    });
  });

  it("reconciles content height when the virtualized layout changes", () => {
    const scrollRef = { current: document.createElement("div") };
    const onContentHeightChange = vi.fn();
    const onInitialAnchorReady = vi.fn();

    render(
      <ChatMessageList
        messages={[
          { id: "message-1", role: "assistant", content: "Hello" } as any,
          { id: "message-2", role: "assistant", content: "World" } as any,
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        heightCache={heightCache}
        onContentHeightChange={onContentHeightChange}
        onInitialAnchorReady={onInitialAnchorReady}
      />,
    );

    expect(onContentHeightChange).toHaveBeenCalledWith({ immediate: true });
    expect(onInitialAnchorReady).toHaveBeenCalled();
  });

  it("runs one batched remeasure when a resize session settles", () => {
    const scrollRef = { current: document.createElement("div") };
    const onContentHeightChange = vi.fn();

    const { rerender } = render(
      <ChatResizeSessionContext.Provider value={{ isActive: false, settledAt: 0 }}>
        <ChatMessageList
          messages={[
            { id: "message-1", role: "assistant", content: "Hello" } as any,
          ]}
          streamKey="stream-1"
          scrollRef={scrollRef}
          heightCache={heightCache}
          onContentHeightChange={onContentHeightChange}
        />
      </ChatResizeSessionContext.Provider>,
    );

    mockMeasure.mockClear();
    onContentHeightChange.mockClear();

    rerender(
      <ChatResizeSessionContext.Provider value={{ isActive: false, settledAt: 1 }}>
        <ChatMessageList
          messages={[
            { id: "message-1", role: "assistant", content: "Hello" } as any,
          ]}
          streamKey="stream-1"
          scrollRef={scrollRef}
          heightCache={heightCache}
          onContentHeightChange={onContentHeightChange}
        />
      </ChatResizeSessionContext.Provider>,
    );

    expect(mockMeasure).toHaveBeenCalledTimes(1);
    expect(onContentHeightChange).toHaveBeenCalledWith({ immediate: true });
  });

  it("shows a load older trigger when older history is available", () => {
    const scrollRef = { current: document.createElement("div") };
    const onLoadOlder = vi.fn();

    const { getByRole } = render(
      <ChatMessageList
        messages={[
          { id: "message-1", role: "assistant", content: "Hello" } as any,
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        heightCache={heightCache}
        hasOlderMessages
        onLoadOlder={onLoadOlder}
      />,
    );

    expect(getByRole("button", { name: "Load older messages" })).toBeInTheDocument();
  });

  it("reconciles content height when the streaming bubble grows", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.streamingText = "partial output";

    const scrollRef = { current: document.createElement("div") };
    const onContentHeightChange = vi.fn();

    render(
      <ChatMessageList
        messages={[
          { id: "message-1", role: "assistant", content: "Hello" } as any,
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        heightCache={heightCache}
        onContentHeightChange={onContentHeightChange}
      />,
    );

    const streamingBubbleContainer = screen.getByTestId("streaming-bubble").parentElement;
    if (!streamingBubbleContainer) {
      throw new Error("Expected streaming bubble container to be rendered");
    }

    Object.defineProperty(streamingBubbleContainer, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 300,
        bottom: nextStreamingBubbleHeight,
        width: 300,
        height: nextStreamingBubbleHeight,
        toJSON: () => ({}),
      }),
    });

    onContentHeightChange.mockClear();
    nextStreamingBubbleHeight = 180;

    act(() => {
      MockResizeObserver.trigger(streamingBubbleContainer);
    });

    expect(onContentHeightChange).toHaveBeenCalledTimes(1);
    expect(onContentHeightChange).toHaveBeenCalledWith({ immediate: true });
  });

  it("reuses the final streaming bubble height for the saved assistant row", () => {
    mockStreamEntry.isStreaming = true;
    mockStreamEntry.streamingText = "partial output";

    const scrollRef = { current: document.createElement("div") };
    const onContentHeightChange = vi.fn();

    const { rerender } = render(
      <ChatMessageList
        messages={[
          { id: "message-1", role: "assistant", content: "Hello" } as any,
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        heightCache={heightCache}
        onContentHeightChange={onContentHeightChange}
      />,
    );

    const streamingBubbleContainer = screen.getByTestId("streaming-bubble").parentElement;
    if (!streamingBubbleContainer) {
      throw new Error("Expected streaming bubble container to be rendered");
    }

    Object.defineProperty(streamingBubbleContainer, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 300,
        bottom: nextStreamingBubbleHeight,
        width: 300,
        height: nextStreamingBubbleHeight,
        toJSON: () => ({}),
      }),
    });

    nextStreamingBubbleHeight = 212;

    act(() => {
      MockResizeObserver.trigger(streamingBubbleContainer);
    });

    vi.mocked(heightCache.setHeight).mockClear();
    onContentHeightChange.mockClear();
    Object.assign(mockStreamEntry, {
      isStreaming: false,
      streamingText: "",
    });

    act(() => {
      rerender(
        <ChatMessageList
          messages={[
            { id: "message-1", role: "assistant", content: "Hello" } as any,
            { id: "message-2", role: "assistant", content: "Saved output" } as any,
          ]}
          streamKey="stream-1"
          scrollRef={scrollRef}
          heightCache={heightCache}
          onContentHeightChange={onContentHeightChange}
        />,
      );
    });

    expect(heightCache.setHeight).toHaveBeenCalledWith("message-2", 212);
    expect(onContentHeightChange).toHaveBeenCalledWith({ immediate: true });
  });
});
