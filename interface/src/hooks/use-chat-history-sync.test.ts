import { renderHook, waitFor } from "@testing-library/react";
import type { DisplaySessionEvent } from "../types/stream";

const mocks = vi.hoisted(() => {
  const historyMessages: DisplaySessionEvent[] = [
    { id: "evt-1", role: "assistant", content: "Hello" },
  ];
  const state = {
    entries: {
      "agent:agent-1": {
        events: historyMessages,
        status: "ready",
        fetchedAt: Date.now(),
        error: null,
        lastMessageAt: "2026-04-13T00:00:00Z",
      },
    } as Record<
      string,
      {
        events: DisplaySessionEvent[];
        status: "ready";
        fetchedAt: number;
        error: string | null;
        lastMessageAt: string | null;
      }
    >,
    fetchHistory: vi.fn(async () => {}),
    invalidateHistory: vi.fn(),
  };

  return {
    historyMessages,
    state,
    useChatHistory: vi.fn(() => ({
      events: historyMessages,
      status: "ready",
      error: null,
    })),
    useChatHistoryStore: Object.assign(
      vi.fn((selector: (state: typeof state) => unknown) => selector(state)),
      {
        getState: () => state,
      },
    ),
    useIsStreaming: vi.fn(() => false),
    getStreamEntry: vi.fn(() => ({ events: [] as DisplaySessionEvent[] })),
  };
});

vi.mock("../stores/chat-history-store", () => ({
  useChatHistory: mocks.useChatHistory,
  useChatHistoryStore: mocks.useChatHistoryStore,
}));

vi.mock("./stream/hooks", () => ({
  useIsStreaming: mocks.useIsStreaming,
}));

vi.mock("./stream/store", () => ({
  getStreamEntry: mocks.getStreamEntry,
}));

import { useChatHistorySync } from "./use-chat-history-sync";

describe("useChatHistorySync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.entries["agent:agent-1"] = {
      events: mocks.historyMessages,
      status: "ready",
      fetchedAt: Date.now(),
      error: null,
      lastMessageAt: "2026-04-13T00:00:00Z",
    };
    mocks.useChatHistory.mockReturnValue({
      events: mocks.historyMessages,
      status: "ready",
      error: null,
    });
    mocks.getStreamEntry.mockReturnValue({ events: [] as DisplaySessionEvent[] });
  });

  it("hydrates ready history into the stream store by default", async () => {
    const resetEvents = vi.fn();

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn: vi.fn(async () => []),
        resetEvents,
      }),
    );

    await waitFor(() => {
      expect(resetEvents).toHaveBeenCalledWith(mocks.historyMessages, {
        allowWhileStreaming: true,
      });
    });
  });

  it("skips initial stream hydration when hydrateToStream is false", async () => {
    const resetEvents = vi.fn();

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn: vi.fn(async () => []),
        resetEvents,
        hydrateToStream: false,
      }),
    );

    await waitFor(() => {
      expect(mocks.state.fetchHistory).toHaveBeenCalled();
    });
    expect(resetEvents).not.toHaveBeenCalled();
  });
});
