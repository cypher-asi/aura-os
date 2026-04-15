import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ChatMessageList } from "./ChatMessageList";

const mockMessageBubble = vi.fn();
let mockVirtualItems = [
  {
    key: "row-0",
    index: 0,
    start: 0,
  },
];
let mockTotalSize = 100;

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => mockVirtualItems.slice(0, count),
    getTotalSize: () => mockTotalSize,
    measureElement: vi.fn(),
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
  beforeEach(() => {
    mockMessageBubble.mockReset();
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
      />,
    );

    expect(mockMessageBubble).toHaveBeenCalledTimes(1);
    expect(mockMessageBubble.mock.calls[0][0]).toEqual({
      message: expect.objectContaining({
        id: "message-1",
      }),
    });
  });

  it("reports layout readiness when messages have been measured", () => {
    const scrollRef = { current: document.createElement("div") };
    const onTailLayoutChange = vi.fn();

    render(
      <ChatMessageList
        messages={[
          { id: "message-1", role: "assistant", content: "Hello" } as any,
          { id: "message-2", role: "assistant", content: "World" } as any,
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        onTailLayoutChange={onTailLayoutChange}
      />,
    );

    expect(onTailLayoutChange).toHaveBeenCalledWith(true);
  });

  it("does not block readiness when the viewport is reading older messages", () => {
    mockVirtualItems = [
      {
        key: "row-0",
        index: 0,
        start: 0,
      },
    ];
    mockTotalSize = 200;
    const scrollRef = { current: document.createElement("div") };
    const onTailLayoutChange = vi.fn();

    render(
      <ChatMessageList
        messages={[
          { id: "message-1", role: "assistant", content: "Hello" } as any,
          { id: "message-2", role: "assistant", content: "World" } as any,
        ]}
        streamKey="stream-1"
        scrollRef={scrollRef}
        onTailLayoutChange={onTailLayoutChange}
      />,
    );

    expect(onTailLayoutChange).toHaveBeenCalledWith(true);
  });
});
