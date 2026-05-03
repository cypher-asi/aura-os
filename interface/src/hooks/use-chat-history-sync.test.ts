import { renderHook, waitFor } from "@testing-library/react";
import type { DisplaySessionEvent } from "../shared/types/stream";

type EventCallback = (event: { content?: Record<string, unknown> }) => void;

const mocks = vi.hoisted(() => {
  const historyMessages: DisplaySessionEvent[] = [
    { id: "evt-1", role: "assistant", content: "Hello" },
  ];
  const streamMetaMap = new Map<string, { lastAccessedAt: number }>();
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
    streamMetaMap,
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
  streamMetaMap: mocks.streamMetaMap,
}));

vi.mock("../stores/event-store/index", () => ({
  useEventStore: mocks.useEventStore,
}));

const sidekickMocks = vi.hoisted(() => {
  const state = {
    streamingAgentInstanceId: null as string | null,
    streamingAgentInstanceIds: [] as string[],
    setStreamingAgentInstanceId: vi.fn((id: string | null) => {
      state.streamingAgentInstanceId = id;
      if (id == null) {
        state.streamingAgentInstanceIds = [];
      } else if (!state.streamingAgentInstanceIds.includes(id)) {
        state.streamingAgentInstanceIds = [...state.streamingAgentInstanceIds, id];
      }
    }),
    setAgentStreaming: vi.fn((id: string, streaming: boolean) => {
      if (streaming) {
        if (!state.streamingAgentInstanceIds.includes(id)) {
          state.streamingAgentInstanceIds = [...state.streamingAgentInstanceIds, id];
        }
      } else {
        state.streamingAgentInstanceIds = state.streamingAgentInstanceIds.filter(
          (x) => x !== id,
        );
      }
      state.streamingAgentInstanceId =
        state.streamingAgentInstanceIds.length > 0
          ? state.streamingAgentInstanceIds[state.streamingAgentInstanceIds.length - 1]
          : null;
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

const screenshotBridgeMocks = vi.hoisted(() => ({
  isAuraCaptureSessionActive: vi.fn(() => false),
}));

vi.mock("../lib/screenshot-bridge", () => ({
  isAuraCaptureSessionActive: screenshotBridgeMocks.isAuraCaptureSessionActive,
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
    screenshotBridgeMocks.isAuraCaptureSessionActive.mockReturnValue(false);
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

  it("keeps transient stream errors when history catches up", async () => {
    const caughtUpHistory: DisplaySessionEvent[] = [
      { id: "evt-user", role: "user", content: "hello" },
      { id: "evt-assistant", role: "assistant", content: "" },
    ];
    mocks.useChatHistory.mockReturnValue({
      events: caughtUpHistory,
      status: "ready",
      error: null,
    });
    mocks.state.entries["agent:agent-1"] = {
      events: caughtUpHistory,
      status: "ready",
      fetchedAt: Date.now(),
      error: null,
      lastMessageAt: "2026-04-13T00:01:00Z",
    };
    mocks.getStreamEntry.mockReturnValue({
      events: [
        { id: "temp-user", role: "user", content: "hello" },
        { id: "error-1", role: "assistant", content: "*Error: failed*" },
      ],
    });

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

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(resetEvents).not.toHaveBeenCalledWith([], {
      allowWhileStreaming: true,
    });
  });

  it("does not clear streamed assistant content for same-length stale history", async () => {
    const staleHistory: DisplaySessionEvent[] = [
      { id: "evt-user", role: "user", content: "hello" },
      { id: "evt-assistant", role: "assistant", content: "" },
    ];
    mocks.useChatHistory.mockReturnValue({
      events: staleHistory,
      status: "ready",
      error: null,
    });
    mocks.state.entries["agent:agent-1"] = {
      events: staleHistory,
      status: "ready",
      fetchedAt: Date.now(),
      error: null,
      lastMessageAt: "2026-04-13T00:01:00Z",
    };
    mocks.getStreamEntry.mockReturnValue({
      events: [
        { id: "temp-user", role: "user", content: "hello" },
        { id: "stream-assistant", role: "assistant", content: "full streamed reply" },
      ],
    });

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

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(resetEvents).not.toHaveBeenCalledWith([], {
      allowWhileStreaming: true,
    });
  });

  it("does not fetch server history during capture sessions", async () => {
    screenshotBridgeMocks.isAuraCaptureSessionActive.mockReturnValue(true);
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        hydrateToStream: false,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.state.hydrateFromCache).not.toHaveBeenCalled();
    expect(mocks.state.fetchHistory).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
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

  it("does not refetch progress snapshots while the local stream is active", async () => {
    vi.useFakeTimers();
    try {
      const resetEvents = vi.fn();
      const fetchFn = vi.fn(async () => []);
      mocks.getStreamEntry.mockReturnValue({
        isStreaming: true,
        events: [
          { id: "temp-user", role: "user", content: "hello" },
        ] as DisplaySessionEvent[],
      });

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

      emit("assistant_turn_progress", {
        content: { project_agent_id: "pa-42", session_id: "s-1" },
      });
      await vi.advanceTimersByTimeAsync(300);

      expect(mocks.state.fetchHistory).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-arms streamingAgentInstanceId when history reports an in-flight assistant turn", async () => {
    sidekickMocks.state.streamingAgentInstanceId = null;
    sidekickMocks.state.streamingAgentInstanceIds = [];
    sidekickMocks.state.setStreamingAgentInstanceId.mockClear();
    sidekickMocks.state.setAgentStreaming.mockClear();
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
      expect(sidekickMocks.state.setAgentStreaming).toHaveBeenCalledWith(
        "pa-42",
        true,
      );
    });
  });

  it("clears streamingAgentInstanceId when the in-flight marker disappears", async () => {
    sidekickMocks.state.streamingAgentInstanceId = null;
    sidekickMocks.state.streamingAgentInstanceIds = [];
    sidekickMocks.state.setStreamingAgentInstanceId.mockClear();
    sidekickMocks.state.setAgentStreaming.mockClear();
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
      expect(sidekickMocks.state.setAgentStreaming).toHaveBeenCalledWith(
        "pa-42",
        true,
      );
    });
    sidekickMocks.state.setAgentStreaming.mockClear();

    mocks.useChatHistory.mockReturnValue({
      events: settled,
      status: "ready",
      error: null,
    });
    rerender();

    await waitFor(() => {
      expect(sidekickMocks.state.setAgentStreaming).toHaveBeenCalledWith(
        "pa-42",
        false,
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

  it("does not overwrite live stream events with a longer-but-stale history snapshot during the post-stream grace window", async () => {
    // Regression for the "assistant turn vanishes at end of stream" bug.
    // When the post-stream `fetchHistory({ force: true })` races with
    // server-side persistence of `assistant_message_end`, the snapshot
    // can briefly carry sanitized / partial assistant content. Replacing
    // freshly-finalized stream events with that snapshot is what causes
    // the visible "all assistant content gone" symptom right when the
    // turn ends. The grace window must defer the reset for ~1500ms.
    //
    // We construct a case the *existing* length-based guard does NOT
    // catch: streamCount=1 (just user) but history returns length=2.
    // Without the grace window, the hydrate would replace the stream
    // with a snapshot that may contain stale assistant content.
    const liveStreamEvents: DisplaySessionEvent[] = [
      { id: "temp-user", role: "user", content: "Hi" },
    ];
    mocks.getStreamEntry.mockReturnValue({ events: liveStreamEvents });
    mocks.streamMetaMap.set("agent-1", { lastAccessedAt: Date.now() });

    const initialHistory: DisplaySessionEvent[] = [
      { id: "evt-user-real", role: "user", content: "Hi" },
    ];
    mocks.useChatHistory.mockReturnValue({
      events: initialHistory,
      status: "ready",
      error: null,
    });
    mocks.state.entries["agent:agent-1"] = {
      events: initialHistory,
      status: "ready",
      fetchedAt: Date.now(),
      error: null,
      lastMessageAt: "2026-04-13T00:00:00Z",
    };

    // First mount during streaming.
    mocks.useIsStreaming.mockReturnValue(true);
    const resetEvents = vi.fn();
    const { rerender } = renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn: vi.fn(async () => []),
        resetEvents,
      }),
    );

    // Streaming → not-streaming transition; this sets streamFinishedAtRef
    // inside the hook so we are now within the grace window.
    mocks.useIsStreaming.mockReturnValue(false);
    rerender();

    // Now history grows (server-driven WS would normally trigger this).
    const longerPartial: DisplaySessionEvent[] = [
      { id: "evt-user-real", role: "user", content: "Hi" },
      // Sanitized / partial assistant content as can arrive mid-persistence.
      { id: "evt-assistant-partial", role: "assistant", content: "" },
    ];
    mocks.useChatHistory.mockReturnValue({
      events: longerPartial,
      status: "ready",
      error: null,
    });
    rerender();

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Grace window must defer the reset; resetEvents must not fire with
    // the stale longer snapshot.
    expect(resetEvents).not.toHaveBeenCalledWith(longerPartial, expect.anything());
  });

  it("does not overwrite live stream events when persisted history is older than the most recent stream mutation", async () => {
    // Even outside the grace window, history that is provably older
    // than our stream's last local write must not clobber the stream —
    // that would also cause the vanishing-assistant symptom whenever a
    // forced refetch returns a stale snapshot.
    const liveStreamEvents: DisplaySessionEvent[] = [
      { id: "temp-user", role: "user", content: "Hi" },
    ];
    mocks.getStreamEntry.mockReturnValue({ events: liveStreamEvents });
    // Stream mutated "now"; persisted history is 10 minutes old.
    mocks.streamMetaMap.set("agent-1", { lastAccessedAt: Date.now() });

    const stalerLonger: DisplaySessionEvent[] = [
      { id: "evt-user-real", role: "user", content: "Hi" },
      { id: "evt-assistant-real", role: "assistant", content: "old reply" },
    ];
    mocks.useChatHistory.mockReturnValue({
      events: stalerLonger,
      status: "ready",
      error: null,
    });
    mocks.state.entries["agent:agent-1"] = {
      events: stalerLonger,
      status: "ready",
      fetchedAt: Date.now(),
      error: null,
      lastMessageAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };

    // Render outside the grace window (no prior streaming transition).
    mocks.useIsStreaming.mockReturnValue(false);
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

    expect(resetEvents).not.toHaveBeenCalledWith(stalerLonger, expect.anything());
  });
});
