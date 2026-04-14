import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ChatMessageList } from "./ChatMessageList";

const mockMessageBubble = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: `row-${index}`,
        index,
        start: index * 100,
      })),
    getTotalSize: () => count * 100,
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
});
