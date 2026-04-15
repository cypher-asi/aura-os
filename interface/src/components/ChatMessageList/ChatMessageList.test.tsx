import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ChatMessageList } from "./ChatMessageList";
import type { MessageHeightCache } from "../../hooks/use-message-height-cache";

const mockMessageBubble = vi.fn();
let mockVirtualItems = [
  {
    key: "row-0",
    index: 0,
    start: 0,
  },
];
let mockTotalSize = 100;
const mockMeasureElement = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => mockVirtualItems.slice(0, count),
    getTotalSize: () => mockTotalSize,
    measureElement: mockMeasureElement,
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
      entries: {},
    }),
}));

describe("ChatMessageList", () => {
  const heightCache: MessageHeightCache = {
    getHeight: vi.fn(() => undefined),
    setHeight: vi.fn(),
    estimateHeight: vi.fn(() => 120),
  };

  beforeEach(() => {
    mockMessageBubble.mockReset();
    mockMeasureElement.mockReset();
    vi.mocked(heightCache.getHeight).mockClear();
    vi.mocked(heightCache.setHeight).mockClear();
    vi.mocked(heightCache.estimateHeight).mockClear();
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
});
