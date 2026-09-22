import { renderHook, waitFor } from "@testing-library/react";
import type { DisplaySessionEvent } from "../../shared/types/stream";

type EventCallback = (event: Record<string, unknown>) => void;

const mocks = vi.hoisted(() => {
  const historyMessages: DisplaySessionEvent[] = [
    { id: "evt-1", role: "assistant", content: "Hello" },
  ];
  const streamMetaMap = new Map<string, { lastAccessedAt: number }>();
  const markStreamInterrupted = vi.fn();
  const clearStreamInterrupted = vi.fn();
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
    pinKey: vi.fn(),
    unpinKey: vi.fn(),
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
    getIsStreaming: vi.fn(() => false),
    markStreamInterrupted,
    clearStreamInterrupted,
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

vi.mock("../../stores/chat-history-store", () => ({
  useChatHistory: mocks.useChatHistory,
  useChatHistoryStore: mocks.useChatHistoryStore,
}));

vi.mock("../stream/hooks", () => ({
  useIsStreaming: mocks.useIsStreaming,
}));

vi.mock("../stream/store", () => ({
  getStreamEntry: mocks.getStreamEntry,
  getIsStreaming: mocks.getIsStreaming,
  markStreamInterrupted: mocks.markStreamInterrupted,
  clearStreamInterrupted: mocks.clearStreamInterrupted,
  streamMetaMap: mocks.streamMetaMap,
}));

const recoveryMocks = vi.hoisted(() => ({
  listActiveStreams: vi.fn(async () => ({ streams: [] })),
  selectReattachableChatStream: vi.fn(() => null),
}));

vi.mock("../../api/client", () => ({
  api: {
    streams: { listActiveStreams: recoveryMocks.listActiveStreams },
  },
}));

vi.mock("../../api/streams", () => ({
  selectReattachableChatStream: recoveryMocks.selectReattachableChatStream,
}));

vi.mock("../../stores/event-store/index", () => ({
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

vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: sidekickMocks.useSidekickStore,
}));

const screenshotBridgeMocks = vi.hoisted(() => ({
  isAuraCaptureSessionActive: vi.fn(() => false),
}));

vi.mock("../../lib/screenshot-bridge", () => ({
  isAuraCaptureSessionActive: screenshotBridgeMocks.isAuraCaptureSessionActive,
}));

/**
 * Phase 4 wire shape: WS events for `user_message` /
 * `assistant_message_end` carry `{ session_id, project_id,
 * project_agent_id, agent_id }` at the TOP LEVEL of the parsed
 * `AuraEvent`. The legacy `agent_instance_id` field is gone; the parser
 * exposes the project binding only via `event.project_agent_id`. The
 * helper below mirrors what `parseAuraEvent` would hand to the
 * subscriber so the matcher tests exercise the post-parse shape.
 */
function emit(
  type: string,
  event: {
    session_id?: string;
    project_id?: string | null;
    project_agent_id?: string | null;
    agent_id?: string | null;
    content?: Record<string, unknown>;
  },
): void {
  const listeners = mocks.eventListeners.get(type);
  if (!listeners) return;
  const parsed = {
    type,
    session_id: event.session_id ?? "",
    project_id: event.project_id ?? "",
    project_agent_id: event.project_agent_id ?? null,
    agent_id: event.agent_id ?? "",
    content: event.content ?? {},
  };
  listeners.forEach((cb: (event: unknown) => void) =>
    (cb as EventCallback)(parsed),
  );
}

import {
  matchesChatEvent,
  maybeLogCrossAgentEvent,
  useChatHistorySync,
} from "./use-chat-history-sync";
import { parseAuraEvent } from "../../shared/types/aura-events";

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
    recoveryMocks.listActiveStreams.mockReset().mockResolvedValue({ streams: [] });
    recoveryMocks.selectReattachableChatStream.mockReset().mockReturnValue(null);
    screenshotBridgeMocks.isAuraCaptureSessionActive.mockReturnValue(false);
  });

  // Regression note: the legacy "hydrates ready history into the stream
  // store by default" behavior was removed in the Phase B projector
  // landing. Both project- and standalone-agent panels now rely on the
  // pure `projectConversation` projector to merge history and stream
  // events, so `useChatHistorySync` no longer copies history into the
  // stream store. The test below documents what the hook does *not* do.

  // Regression test for the "CEO chat blink" eviction race: the active
  // chat panel must pin its `historyKey` in the chat-history-store
  // LRU for the panel's lifetime, and release it on unmount.
  it("pins the active historyKey on mount and unpins it on unmount", () => {
    const { unmount } = renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn: vi.fn(async () => []),
        resetEvents: vi.fn(),
      }),
    );

    expect(mocks.state.pinKey).toHaveBeenCalledWith("agent:agent-1");
    expect(mocks.state.unpinKey).not.toHaveBeenCalled();

    unmount();

    expect(mocks.state.unpinKey).toHaveBeenCalledWith("agent:agent-1");
  });

  it("does not pin when historyKey is undefined", () => {
    const { unmount } = renderHook(() =>
      useChatHistorySync({
        historyKey: undefined,
        streamKey: "agent-1",
        fetchFn: undefined,
        resetEvents: vi.fn(),
      }),
    );

    expect(mocks.state.pinKey).not.toHaveBeenCalled();
    unmount();
    expect(mocks.state.unpinKey).not.toHaveBeenCalled();
  });

  it("never hydrates ready history into the stream store", async () => {
    // Phase B contract: the hook fetches and pins history but the
    // projector in `useConversationSnapshot` reads `historyMessages`
    // directly. `resetEvents` is reserved for the caught-up clear path.
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
      project_agent_id: "pa-42",
      session_id: "s-1",
      content: { message_id: "m-1" },
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
      project_agent_id: "pa-42",
      session_id: "s-1",
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
      project_agent_id: "pa-other",
      session_id: "s-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.state.fetchHistory).not.toHaveBeenCalled();
  });

  it("force-refetches when watchAgentId matches event.agent_id", async () => {
    // Covers the standalone-chat path: the hook keys history by the
    // org-level agent_id, so it must react to `user_message` events
    // published by the server's `publish_user_message_event`, which
    // carries `agent_id` at the top level after the Phase 4 wire-shape
    // change. Without the `watchAgentId` branch a cross-agent
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
      project_agent_id: "pa-42",
      agent_id: "agent-1",
      session_id: "s-1",
    });

    await waitFor(() => {
      expect(mocks.state.fetchHistory).toHaveBeenCalledWith(
        "agent:agent-1",
        fetchFn,
        { force: true },
      );
    });
  });

  it("retries matched chat-event refetches after storage has settled", async () => {
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
          watchAgentId: "agent-1",
        }),
      );
      mocks.state.fetchHistory.mockClear();

      emit("user_message", {
        project_agent_id: "pa-42",
        agent_id: "agent-1",
        session_id: "s-1",
      });

      expect(mocks.state.fetchHistory).toHaveBeenCalledTimes(1);
      expect(mocks.state.fetchHistory).toHaveBeenLastCalledWith(
        "agent:agent-1",
        fetchFn,
        { force: true },
      );

      await vi.advanceTimersByTimeAsync(749);
      expect(mocks.state.fetchHistory).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.state.fetchHistory).toHaveBeenCalledTimes(2);
      expect(mocks.state.fetchHistory).toHaveBeenLastCalledWith(
        "agent:agent-1",
        fetchFn,
        { force: true },
      );
    } finally {
      vi.useRealTimers();
    }
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
          project_agent_id: "pa-42",
          session_id: "s-1",
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
        project_agent_id: "pa-42",
        session_id: "s-1",
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

  it("marks a persisted in-flight turn interrupted when the runtime has no active stream", async () => {
    const inFlight: DisplaySessionEvent[] = [
      { id: "evt-user", role: "user", content: "finish the migration" },
      {
        id: "evt-assistant",
        role: "assistant",
        content: "I updated the schema…",
        inFlight: true,
      },
    ];
    mocks.useChatHistory.mockReturnValue({
      events: inFlight,
      status: "ready",
      error: null,
    });

    renderHook(() =>
      useChatHistorySync({
        historyKey: "session:s-1",
        streamKey: "project-1:pa-42:s-1",
        fetchFn: vi.fn(async () => []),
        resetEvents: vi.fn(),
        watchAgentInstanceId: "pa-42",
        watchSessionId: "s-1",
      }),
    );

    await waitFor(() => {
      expect(mocks.markStreamInterrupted).toHaveBeenCalledWith(
        "project-1:pa-42:s-1",
      );
    });
    expect(recoveryMocks.listActiveStreams).toHaveBeenCalledWith({
      agent_instance_id: "pa-42",
    });
    expect(sidekickMocks.state.setAgentStreaming).toHaveBeenLastCalledWith(
      "pa-42",
      false,
    );
  });

  it("keeps an in-flight turn recoverable when stream discovery fails", async () => {
    recoveryMocks.listActiveStreams.mockRejectedValue(
      new Error("host temporarily unreachable"),
    );
    mocks.useChatHistory.mockReturnValue({
      events: [
        {
          id: "evt-assistant",
          role: "assistant",
          content: "Still working…",
          inFlight: true,
        },
      ],
      status: "ready",
      error: null,
    });

    renderHook(() =>
      useChatHistorySync({
        historyKey: "session:s-1",
        streamKey: "project-1:pa-42:s-1",
        fetchFn: vi.fn(async () => []),
        resetEvents: vi.fn(),
        watchAgentInstanceId: "pa-42",
        watchSessionId: "s-1",
      }),
    );

    await waitFor(() => {
      expect(recoveryMocks.listActiveStreams).toHaveBeenCalled();
    });
    expect(mocks.markStreamInterrupted).not.toHaveBeenCalled();
    expect(sidekickMocks.state.setAgentStreaming).toHaveBeenCalledWith(
      "pa-42",
      true,
    );
  });

  it("does not mark interruption while the canonical session is attachable", async () => {
    const active = {
      attach_id: "stream-1",
      kind: "chat_turn",
      scope: { session_id: "s-1" },
      latest_seq: 4,
      terminated: false,
      started_at_ms: 1,
    };
    recoveryMocks.listActiveStreams.mockResolvedValue({ streams: [active] });
    recoveryMocks.selectReattachableChatStream.mockReturnValue(active);
    mocks.useChatHistory.mockReturnValue({
      events: [
        {
          id: "evt-assistant",
          role: "assistant",
          content: "Still working…",
          inFlight: true,
        },
      ],
      status: "ready",
      error: null,
    });

    renderHook(() =>
      useChatHistorySync({
        historyKey: "session:s-1",
        streamKey: "project-1:pa-42:s-1",
        fetchFn: vi.fn(async () => []),
        resetEvents: vi.fn(),
        watchAgentInstanceId: "pa-42",
        watchSessionId: "s-1",
      }),
    );

    await waitFor(() => {
      expect(mocks.clearStreamInterrupted).toHaveBeenCalledWith(
        "project-1:pa-42:s-1",
      );
    });
    expect(mocks.markStreamInterrupted).not.toHaveBeenCalled();
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

  it("invalidates history before fetching when the cache is stale", async () => {
    mocks.getIsStreaming.mockReturnValue(false);
    // Drive the freshness gate to "stale" — older than the prefetch
    // freshness window — so the invalidation path is exercised.
    mocks.state.entries["agent:agent-1"] = {
      events: mocks.historyMessages,
      status: "ready",
      fetchedAt: Date.now() - 60_000,
      error: null,
      lastMessageAt: "2026-04-13T00:00:00Z",
    };
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        invalidateBeforeFetch: true,
      }),
    );

    await waitFor(() => {
      expect(mocks.state.invalidateHistory).toHaveBeenCalledWith("agent:agent-1");
    });
    expect(mocks.state.fetchHistory).toHaveBeenCalled();
  });

  // Hover-prefetch + click flicker fix: if a sidebar prefetch landed
  // the destination key in the chat-history-store within the freshness
  // window, the on-mount `invalidateBeforeFetch` path must NOT clobber
  // `fetchedAt` — that would flip `historyResolved` false for one
  // render and re-arm `ChatPanel`'s cold-load gate, recreating the
  // exact `.messageContentHidden` flicker the prefetch is meant to
  // eliminate. The follow-up `fetchHistory` still runs in this branch,
  // so a freshness check against cross-tab writes is preserved.
  it("skips invalidation when the entry was just prefetched", async () => {
    mocks.getIsStreaming.mockReturnValue(false);
    mocks.state.entries["agent:agent-1"] = {
      events: mocks.historyMessages,
      status: "ready",
      fetchedAt: Date.now(),
      error: null,
      lastMessageAt: "2026-04-13T00:00:00Z",
    };
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        invalidateBeforeFetch: true,
      }),
    );

    await waitFor(() => {
      expect(mocks.state.fetchHistory).toHaveBeenCalled();
    });
    expect(mocks.state.invalidateHistory).not.toHaveBeenCalled();
  });

  // Empty-ready cache fix: a hover prefetch that landed an EMPTY `ready`
  // entry (e.g. a subagent session whose child transcript had not been
  // persisted yet when the row was hovered) must NOT be trusted on click —
  // the `fetchHistory` TTL short-circuit would otherwise serve the empty
  // cache and strand the panel blank until a hard refresh. An empty fresh
  // entry is invalidated so the follow-up fetch revalidates the network.
  it("invalidates a freshly-prefetched but EMPTY ready entry", async () => {
    mocks.getIsStreaming.mockReturnValue(false);
    mocks.state.entries["agent:agent-1"] = {
      events: [],
      status: "ready",
      fetchedAt: Date.now(),
      error: null,
      lastMessageAt: null,
    };
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        invalidateBeforeFetch: true,
      }),
    );

    await waitFor(() => {
      expect(mocks.state.invalidateHistory).toHaveBeenCalledWith("agent:agent-1");
    });
    expect(mocks.state.fetchHistory).toHaveBeenCalled();
  });

  // Regression test for the "user message disappears mid-send" flicker.
  // After the first send on a fresh canvas, `SessionReady` flips the URL
  // to `?session=<id>` which causes the panel's `historyKey` to recompute
  // (`project:...` → `session:...:<id>`). If `invalidateHistory` runs on
  // the new key it sets `fetchedAt=0`, drives `historyResolved` false,
  // and re-arms the ChatPanel cold-load gate just long enough to flash
  // `.messageContentHidden` over the optimistic user bubble.
  it("skips invalidation when a turn is actively streaming on this streamKey", async () => {
    mocks.getIsStreaming.mockReturnValue(true);
    const resetEvents = vi.fn();
    const fetchFn = vi.fn(async () => []);

    renderHook(() =>
      useChatHistorySync({
        historyKey: "agent:agent-1",
        streamKey: "agent-1",
        fetchFn,
        resetEvents,
        invalidateBeforeFetch: true,
      }),
    );

    await waitFor(() => {
      expect(mocks.state.fetchHistory).toHaveBeenCalled();
    });
    expect(mocks.state.invalidateHistory).not.toHaveBeenCalled();
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

// Phase 5 — direct unit tests for the matcher helper. These exercise
// the contract that powers the cross-agent live-update path documented
// on `matchesChatEvent`: ANY of session_id / project_agent_id / agent_id
// matching the watch params is sufficient to fire a refetch.
describe("matchesChatEvent", () => {
  it("matcher_fires_for_session_id_match", () => {
    expect(
      matchesChatEvent(
        {
          session_id: "s-pinned",
          project_agent_id: "pa-other",
          agent_id: "agent-other",
        },
        {
          watchSessionId: "s-pinned",
          watchAgentInstanceId: "pa-self",
          watchAgentId: "agent-self",
        },
      ),
    ).toBe(true);
  });

  it("matcher_fires_for_project_agent_id_match_when_no_session_pin", () => {
    // Receiver project panel without `?session=` pin: the cross-agent
    // `user_message` event MUST still trigger a refetch when the event's
    // `project_agent_id` matches the panel's `watchAgentInstanceId`.
    expect(
      matchesChatEvent(
        {
          session_id: "s-from-other-agent",
          project_agent_id: "pa-42",
          agent_id: "agent-x",
        },
        {
          watchAgentInstanceId: "pa-42",
        },
      ),
    ).toBe(true);
  });

  it("matcher_fires_for_agent_id_match_on_standalone_panel", () => {
    // Receiver standalone panel: `watchAgentId` is the org-level id and
    // must match the event's `agent_id` from the new Phase 4 wire shape.
    expect(
      matchesChatEvent(
        {
          session_id: "s-anything",
          project_agent_id: "pa-anything",
          agent_id: "agent-1",
        },
        {
          watchAgentId: "agent-1",
        },
      ),
    ).toBe(true);
  });

  it("matcher_does_not_fire_for_unrelated_event", () => {
    expect(
      matchesChatEvent(
        {
          session_id: "s-unrelated",
          project_agent_id: "pa-unrelated",
          agent_id: "agent-unrelated",
        },
        {
          watchSessionId: "s-mine",
          watchAgentInstanceId: "pa-mine",
          watchAgentId: "agent-mine",
        },
      ),
    ).toBe(false);
  });

  it("returns false when the event is undefined", () => {
    expect(
      matchesChatEvent(undefined, { watchAgentInstanceId: "pa-1" }),
    ).toBe(false);
  });
});

// Phase 6 — gate-behavior pin for the cross-agent diagnostic.
// `window.__AURA_DEBUG_CROSS_AGENT__` is the single, devtools-flippable
// toggle that unlocks the `[aura.cross-agent] ws event` console.debug
// inside the use-chat-history-sync subscription. These tests guard
// against a future "let's clean up unused debug code" sweep that would
// silently rip the diagnostic out — without the flag the operator
// cannot reconstruct B's missing live-update from the browser console.
describe("maybeLogCrossAgentEvent (Phase 6 gate)", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    delete (globalThis as { __AURA_DEBUG_CROSS_AGENT__?: unknown })
      .__AURA_DEBUG_CROSS_AGENT__;
  });

  it("logs an [aura.cross-agent] line when the flag is truthy", () => {
    (globalThis as { __AURA_DEBUG_CROSS_AGENT__?: unknown })
      .__AURA_DEBUG_CROSS_AGENT__ = true;
    const event = {
      type: "user_message",
      session_id: "s-1",
      project_agent_id: "pa-1",
      agent_id: "a-1",
    };
    const watch = { watchAgentInstanceId: "pa-1" };
    const matched = matchesChatEvent(event, watch);

    maybeLogCrossAgentEvent(event, watch, matched);

    expect(debugSpy).toHaveBeenCalledTimes(1);
    const firstArg = debugSpy.mock.calls[0]?.[0];
    expect(typeof firstArg).toBe("string");
    expect(firstArg as string).toMatch(/^\[aura\.cross-agent\]/);
  });

  it("does not log when the flag is undefined", () => {
    expect(
      (globalThis as { __AURA_DEBUG_CROSS_AGENT__?: unknown })
        .__AURA_DEBUG_CROSS_AGENT__,
    ).toBeUndefined();

    maybeLogCrossAgentEvent(
      {
        type: "user_message",
        session_id: "s-1",
        project_agent_id: "pa-1",
        agent_id: "a-1",
        user_id: "user-1",
      },
      { watchAgentInstanceId: "pa-1" },
      true,
    );

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("does not log when the flag is explicitly falsy", () => {
    (globalThis as { __AURA_DEBUG_CROSS_AGENT__?: unknown })
      .__AURA_DEBUG_CROSS_AGENT__ = false;

    maybeLogCrossAgentEvent(
      {
        type: "user_message",
        session_id: "s-1",
        project_agent_id: "pa-1",
        agent_id: "a-1",
      },
      { watchAgentInstanceId: "pa-1" },
      false,
    );

    expect(debugSpy).not.toHaveBeenCalled();
  });
});

// Phase 5 — parser unit tests. These pin the post-Phase-4 wire shape
// for `user_message` / `assistant_message_end` and the legacy fallback
// for the event types that still emit `agent_instance_id`.
describe("parseAuraEvent (Phase 5 wire shape)", () => {
  it("parser_populates_project_agent_id_from_new_wire_shape", () => {
    const event = parseAuraEvent(
      "user_message",
      {
        type: "user_message",
        session_id: "s-1",
        project_id: "p-1",
        project_agent_id: "pa-1",
        agent_id: "a-1",
        user_id: "user-1",
      },
      {},
    );
    expect(event.project_agent_id).toBe("pa-1");
    expect(event.agent_id).toBe("a-1");
    expect(event.session_id).toBe("s-1");
    expect(event.project_id).toBe("p-1");
    expect(event.user_id).toBe("user-1");
  });

  it("parser_falls_back_to_legacy_agent_instance_id", () => {
    // `session_summary_updated` still ships `agent_instance_id` after
    // Phase 4. The parser must surface it through `project_agent_id`
    // so the matcher (which only looks at the new field name) keeps
    // working for the legacy event types.
    const event = parseAuraEvent(
      "session_summary_updated",
      {
        type: "session_summary_updated",
        session_id: "s-2",
        agent_instance_id: "pa-2",
      },
      {},
    );
    expect(event.project_agent_id).toBe("pa-2");
    expect(event.session_id).toBe("s-2");
  });
});
