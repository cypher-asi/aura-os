import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamingTail } from "./StreamingTail";

const streamState = vi.hoisted(() => ({
  entry: {
    isStreaming: true,
    isWriting: false,
    streamingText: "",
    thinkingText: "Starting to reason",
    thinkingDurationMs: null as number | null,
    activeToolCalls: [],
    timeline: [],
    progressText: "",
    generationKind: null,
    generationPercent: null,
  },
}));

vi.mock("../../../hooks/stream/store", () => ({
  useStreamStore: (selector: (state: unknown) => unknown) =>
    selector({ entries: { "stream-1": streamState.entry } }),
}));

vi.mock("../../../apps/chat/components/StreamingBubble", () => ({
  StreamingBubble: ({
    text,
    thinkingText,
  }: {
    text: string;
    thinkingText?: string;
  }) => <div>{thinkingText || text}</div>,
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

describe("StreamingTail auto-follow", () => {
  beforeEach(() => {
    streamState.entry.thinkingText = "Starting to reason";
  });

  it("keeps newly committed thinking output visible without a parent re-render", () => {
    const scrollRef = makeScrollRef({ scrollHeight: 800, scrollTop: 400 });
    const { rerender } = render(
      <StreamingTail
        streamKey="stream-1"
        scrollRef={scrollRef}
        isAutoFollowing
      />,
    );

    expect(scrollRef.current.scrollTop).toBe(800);

    streamState.entry.thinkingText =
      "Starting to reason, then continuing onto enough new lines to grow the live tail";
    (scrollRef.current as unknown as { scrollHeight: number }).scrollHeight = 1040;

    rerender(
      <StreamingTail
        streamKey="stream-1"
        scrollRef={scrollRef}
        isAutoFollowing
      />,
    );

    expect(scrollRef.current.scrollTop).toBe(1040);
  });

  it("preserves the reading position after explicit upward scroll intent", () => {
    const scrollRef = makeScrollRef({ scrollHeight: 1040, scrollTop: 420 });

    render(
      <StreamingTail
        streamKey="stream-1"
        scrollRef={scrollRef}
        isAutoFollowing
        getUserUnpinnedAt={() => 1234}
      />,
    );

    expect(scrollRef.current.scrollTop).toBe(420);
  });

  it("does not follow live output after the parent has entered reading mode", () => {
    const scrollRef = makeScrollRef({ scrollHeight: 1040, scrollTop: 420 });

    render(
      <StreamingTail
        streamKey="stream-1"
        scrollRef={scrollRef}
        isAutoFollowing={false}
      />,
    );

    expect(scrollRef.current.scrollTop).toBe(420);
  });
});
