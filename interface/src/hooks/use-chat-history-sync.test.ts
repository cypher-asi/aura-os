import { renderHook, waitFor } from "@testing-library/react";
import type { DisplaySessionEvent } from "../types/stream";

type EventCallback = (event: { content?: Record<string, unknown> }) => void;

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
    hydrateFromCache: vi.fn(async () => {}),
  };

  const eventListeners = new Map<string, Set<(event: unknown) => void>>();
  const subscribe = vi.fn((type: string, cb: (event: unknown) => void) => {
    let set = eventListeners.get(type);
    if (!set) {
      set = new Set();
      eventListeners.set(type, set);
    }
    set.add(cb);
    return () => {
      eventListeners.get(type)?.delete(cb);
    };
  });

  return {
    historyMessages,
    state,
    eventListeners,
    subscribe,
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
    useEventStore: Object.assign(
      vi.fn((selector: (s: { subscribe: typeof subscribe }) => unknown) =>
        selector({ subscribe }),
      ),
      {
        getState: () => ({ subscribe }),
      },
    ),
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

vi.mock("../stores/event-store/index", () => ({
  useEventStore: mocks.useEventStore,
}));

const sidekickMocks = vi.hoisted(() => {
  const state = {
    streamingAgentInstanceId: null as string | null,
    setStreamingAgentInstanceId: vi.fn((id: string | null) => {
      state.streamingAgentInstanceId = id;
    }),
    specs: [] as Array<{ spec_id: string; title: string }>,
    tasks: [] as Array<{ task_id: string; title: string }>,
    pushSpec: vi.fn(),
    pushTask: vi.fn(),
  };
  return {
    state,
    useSidekickStore: Object.assign(
      vi.fn(),
      {
        getState: () => state,
      },
    ),
  };
});

vi.mock("../stores/sidekick-store", () => ({
  useSidekickStore: sidekickMocks.useSidekickStore,
}));

function emit(type: string, event: { content: Record<string, unknown> }): void {
  const listeners = mocks.eventListeners.get(type);
  if (!listeners) return;
  listeners.forEach((cb: (event: unknown) => void) =>
    (cb as EventCallback)(event),
  );
}

import { useChatHistorySync } from "./use-chat-history-sync";

describe("useChatHistorySync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventListeners.clear();
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

  it("force-refetches history when a matching UserMessage event arrives", async () => {
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        watchAgentInstanceId: "pa-42",
      }),
    );

    await waitFor(() => {
      expect(mocks.subscribe).toHaveBeenCalled();
    });
    mocks.state.fetchHistory.mockClear();

    emit("user_message", {
      content: {
        project_agent_id: "pa-42",
        session_id: "s-1",
        message_id: "m-1",
      },
    });

    await waitFor(() => {
      expect(mocks.state.fetchHistory).toHaveBeenCalledWith(
        "agent:agent-1",
        fetchFn,
        { force: true },
      );
    });
  });

  it("force-refetches history when a matching AssistantMessageEnd event arrives", async () => {
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        watchAgentInstanceId: "pa-42",
      }),
    );
    mocks.state.fetchHistory.mockClear();

    emit("assistant_message_end", {
      content: {
        agent_instance_id: "pa-42",
        session_id: "s-1",
      },
    });

    await waitFor(() => {
      expect(mocks.state.fetchHistory).toHaveBeenCalledWith(
        "agent:agent-1",
        fetchFn,
        { force: true },
      );
    });
  });

  it("ignores events for a different agent instance", async () => {
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        watchAgentInstanceId: "pa-42",
      }),
    );
    mocks.state.fetchHistory.mockClear();

    emit("user_message", {
      content: {
        project_agent_id: "pa-other",
        session_id: "s-1",
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.state.fetchHistory).not.toHaveBeenCalled();
  });

  it("filters by session id when watchSessionId is set", async () => {
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        watchAgentInstanceId: "pa-42",
        watchSessionId: "s-target",
      }),
    );
    mocks.state.fetchHistory.mockClear();

    emit("user_message", {
      content: {
        project_agent_id: "pa-42",
        session_id: "s-other",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.state.fetchHistory).not.toHaveBeenCalled();

    emit("user_message", {
      content: {
        project_agent_id: "pa-42",
        session_id: "s-target",
      },
    });
    await waitFor(() => {
      expect(mocks.state.fetchHistory).toHaveBeenCalled();
    });
  });

  it("force-refetches when watchAgentId matches content.agent_id", async () => {
    // Covers the standalone-chat path: the hook keys history by the
    // org-level agent_id, so it must react to `user_message` events
    // published by the server's `publish_user_message_event`, which
    // carries `agent_id` (and `project_agent_id` that differs from
    // the key). Without the `watchAgentId` branch a cross-agent
    // `send_to_agent` delivery leaves the target chat panel stale.
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        watchAgentId: "agent-1",
      }),
    );
    mocks.state.fetchHistory.mockClear();

    emit("assistant_message_end", {
      content: {
        project_agent_id: "pa-42",
        agent_id: "agent-1",
        session_id: "s-1",
      },
    });

    await waitFor(() => {
      expect(mocks.state.fetchHistory).toHaveBeenCalledWith(
        "agent:agent-1",
        fetchFn,
        { force: true },
      );
    });
  });

  it("debounces refetches triggered by assistant_turn_progress events", async () => {
    vi.useFakeTimers();
    try {
      const resetEvents = vi.fn();
      const fetchFn = vi.fn(async () => []);

      renderHook(() =>
        useChatHistorySync({
          historyKey: "agent:agent-1",
          streamKey: "agent-1",
          fetchFn,
          resetEvents,
          watchAgentInstanceId: "pa-42",
        }),
      );
      mocks.state.fetchHistory.mockClear();

      // Burst of progress publishes — only one trailing-edge fetch
      // should fire after the debounce window elapses.
      for (let i = 0; i < 5; i++) {
        emit("assistant_turn_progress", {
          content: { project_agent_id: "pa-42", session_id: "s-1" },
        });
      }
      expect(mocks.state.fetchHistory).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(300);
      expect(mocks.state.fetchHistory).toHaveBeenCalledTimes(1);
      expect(mocks.state.fetchHistory).toHaveBeenCalledWith(
        "agent:agent-1",
        fetchFn,
        { force: true },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-arms streamingAgentInstanceId when history reports an in-flight assistant turn", async () => {
    sidekickMocks.state.streamingAgentInstanceId = null;
    sidekickMocks.state.setStreamingAgentInstanceId.mockClear();
    const inFlightMessages: DisplaySessionEvent[] = [
      { id: "evt-1", role: "user", content: "hi" },
      {
        id: "evt-2",
        role: "assistant",
        content: "Working on it…",
        inFlight: true,
        toolCalls: [],
      },
    ];
    mocks.useChatHistory.mockReturnValue({
      events: inFlightMessages,
      status: "ready",
      error: null,
    });

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn: vi.fn(async () => []),
        resetEvents: vi.fn(),
        watchAgentInstanceId: "pa-42",
      }),
    );

    await waitFor(() => {
      expect(sidekickMocks.state.setStreamingAgentInstanceId).toHaveBeenCalledWith(
        "pa-42",
      );
    });
  });

  it("clears streamingAgentInstanceId when the in-flight marker disappears", async () => {
    sidekickMocks.state.streamingAgentInstanceId = null;
    sidekickMocks.state.setStreamingAgentInstanceId.mockClear();
    const inFlight: DisplaySessionEvent[] = [
      {
        id: "evt-2",
        role: "assistant",
        content: "Working…",
        inFlight: true,
        toolCalls: [],
      },
    ];
    const settled: DisplaySessionEvent[] = [
      { id: "evt-2", role: "assistant", content: "Done.", inFlight: false },
    ];

    mocks.useChatHistory.mockReturnValue({
      events: inFlight,
      status: "ready",
      error: null,
    });

    const { rerender } = renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn: vi.fn(async () => []),
        resetEvents: vi.fn(),
        watchAgentInstanceId: "pa-42",
      }),
    );

    await waitFor(() => {
      expect(sidekickMocks.state.setStreamingAgentInstanceId).toHaveBeenCalledWith(
        "pa-42",
      );
    });
    sidekickMocks.state.setStreamingAgentInstanceId.mockClear();

    mocks.useChatHistory.mockReturnValue({
      events: settled,
      status: "ready",
      error: null,
    });
    rerender();

    await waitFor(() => {
      expect(sidekickMocks.state.setStreamingAgentInstanceId).toHaveBeenCalledWith(
        null,
      );
    });
  });

  it("does not subscribe when neither watch param is set", async () => {
    const resetEvents = vi.fn();

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn: vi.fn(async () => []),
        resetEvents,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
});
