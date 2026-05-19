import { renderHook, act } from "@testing-library/react";
import { useChatStream } from "./use-chat-stream";
import {
  useStreamStore,
  streamMetaMap,
  keyForProjectSession,
} from "../stream/store";
import { useChatUIStore } from "../../stores/chat-ui-store";
import { useSessionsListStore } from "../../stores/sessions-list-store";
import { EventType, type AuraEvent } from "../../shared/types/aura-events";
import {
  _resetAllPartitionSendControl,
  _peekPartitionSendControl,
} from "./partition-send-control";
import type { StreamEventHandler } from "../../api/streams";

const mockSetStreamingAgentInstanceId = vi.fn();
const mockSetAgentStreaming = vi.fn();
const mockClearGeneratedArtifacts = vi.fn();
const mockSetActiveTab = vi.fn();
const mockPushSpec = vi.fn();
const mockPushTask = vi.fn();
const mockRemoveSpec = vi.fn();
const mockRemoveTask = vi.fn();
const mockNotifyAgentInstanceUpdate = vi.fn();

const mockSidekickState = {
  previewItem: null,
  streamingAgentInstanceIds: [] as string[],
  streamingAgentInstanceId: null as string | null,
  setStreamingAgentInstanceId: mockSetStreamingAgentInstanceId,
  setAgentStreaming: mockSetAgentStreaming,
  clearGeneratedArtifacts: mockClearGeneratedArtifacts,
  setActiveTab: mockSetActiveTab,
  pushSpec: mockPushSpec,
  pushTask: mockPushTask,
  removeSpec: mockRemoveSpec,
  removeTask: mockRemoveTask,
  notifyAgentInstanceUpdate: mockNotifyAgentInstanceUpdate,
};
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => ({
    setProject: vi.fn(),
  }),
}));

vi.mock("../../api/client", () => ({
  api: {
    sendEventStream: vi.fn().mockResolvedValue(undefined),
    getAgentInstance: vi.fn().mockResolvedValue({}),
    cancelInstanceTurn: vi.fn().mockResolvedValue(undefined),
  },
  isInsufficientCreditsError: vi.fn(() => false),
  isAgentBusyError: vi.fn(() => null),
  isHarnessCapacityExhaustedError: vi.fn(() => null),
  dispatchInsufficientCredits: vi.fn(),
}));

vi.mock("../../api/streams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/streams")>();
  return {
    ...actual,
    generateImageStream: vi.fn().mockResolvedValue(undefined),
    generate3dStream: vi.fn().mockResolvedValue(undefined),
    generateVideoStream: vi.fn().mockResolvedValue(undefined),
  };
});

import { api } from "../../api/client";

interface CapturedSendCall {
  projectId: string;
  agentInstanceId: string;
  content: string;
  handler: StreamEventHandler;
  signal: AbortSignal | undefined;
  resolve: () => void;
  reject: (err: unknown) => void;
}

function setupSendStreamCapture(): {
  calls: CapturedSendCall[];
  installHandler: (cb: (call: CapturedSendCall) => void | Promise<void>) => void;
  reset: () => void;
} {
  const calls: CapturedSendCall[] = [];
  let onCall: ((call: CapturedSendCall) => void | Promise<void>) | null = null;
  vi.mocked(api.sendEventStream).mockImplementation(
    (
      projectId,
      agentInstanceId,
      content,
      _action,
      _model,
      _attachments,
      handler,
      signal,
    ) => {
      let resolve!: () => void;
      let reject!: (err: unknown) => void;
      const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const call: CapturedSendCall = {
        projectId: projectId as string,
        agentInstanceId,
        content,
        handler: handler as StreamEventHandler,
        signal,
        resolve,
        reject,
      };
      calls.push(call);
      if (onCall) void onCall(call);
      return promise;
    },
  );
  return {
    calls,
    installHandler: (cb) => {
      onCall = cb;
    },
    reset: () => {
      calls.length = 0;
      onCall = null;
    },
  };
}

describe("useChatStream parallel chats", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    useChatUIStore.setState({ streams: {} });
    useSessionsListStore.setState({
      sessionsBySurface: {},
      loadingBySurface: {},
      deleteErrorBySurface: {},
      version: 0,
    });
    _resetAllPartitionSendControl();
    vi.clearAllMocks();
    vi.mocked(api.sendEventStream).mockReset().mockResolvedValue(undefined);
  });

  it("Symptom 1: B's send is not blocked by A's in-flight stream after a panel swap", async () => {
    const capture = setupSendStreamCapture();

    const { result, rerender } = renderHook(
      ({ projectId, agentInstanceId }) =>
        useChatStream({ projectId, agentInstanceId }),
      { initialProps: { projectId: "p-1", agentInstanceId: "ai-A" } },
    );

    await act(async () => {
      void result.current.sendMessage("hi from A");
      await Promise.resolve();
    });

    rerender({ projectId: "p-1", agentInstanceId: "ai-B" });

    await act(async () => {
      void result.current.sendMessage("hi from B");
      await Promise.resolve();
    });

    expect(capture.calls).toHaveLength(2);
    expect(capture.calls[0].agentInstanceId).toBe("ai-A");
    expect(capture.calls[0].content).toBe("hi from A");
    expect(capture.calls[1].agentInstanceId).toBe("ai-B");
    expect(capture.calls[1].content).toBe("hi from B");

    // Both partitions should be marked streaming on their own slots
    // (no cross-partition leak). Phase 3: keys now embed the
    // session-id placeholder (`fresh` here equals
    // `FRESH_SESSION_PLACEHOLDER` from `stream/store.ts`; spelled as
    // a literal so the test pins the on-the-wire key shape).
    const entries = useStreamStore.getState().entries;
    expect(entries["p-1:ai-A:fresh"]?.isStreaming).toBe(true);
    expect(entries["p-1:ai-B:fresh"]?.isStreaming).toBe(true);

    // Cleanup so unawaited promises don't hang the suite.
    for (const c of capture.calls) c.resolve();
  });

  it("Symptom 2: A's stream finalizes on the captured partition after a switch to B", async () => {
    const capture = setupSendStreamCapture();

    const { result, rerender } = renderHook(
      ({ projectId, agentInstanceId }) =>
        useChatStream({ projectId, agentInstanceId }),
      { initialProps: { projectId: "p-1", agentInstanceId: "ai-A" } },
    );

    await act(async () => {
      void result.current.sendMessage("hi from A");
      await Promise.resolve();
    });

    expect(capture.calls).toHaveLength(1);
    const aHandler = capture.calls[0].handler;

    // Panel swaps to agent B mid-stream. A's stream is still in flight.
    rerender({ projectId: "p-1", agentInstanceId: "ai-B" });
    await act(async () => {
      await Promise.resolve();
    });

    // Drive A's stream to a clean assistant end via the captured handler.
    await act(async () => {
      aHandler.onEvent?.({
        type: EventType.TextDelta,
        content: { text: "hello from A" },
      } as AuraEvent);
      aHandler.onEvent?.({
        type: EventType.AssistantMessageEnd,
        content: { stop_reason: "end_turn" },
      } as AuraEvent);
      await Promise.resolve();
    });

    // Resolve A's POST so the finally block runs.
    await act(async () => {
      capture.calls[0].resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const aEntry = useStreamStore.getState().entries["p-1:ai-A:fresh"];
    expect(aEntry).toBeDefined();
    expect(aEntry.isStreaming).toBe(false);
    // Should contain the user message + the assistant placeholder
    // appended by handleAssistantTurnBoundary.
    expect(aEntry.events.length).toBeGreaterThanOrEqual(2);
    const assistantEvent = aEntry.events.find((e) => e.role === "assistant");
    expect(assistantEvent).toBeDefined();
    expect(assistantEvent?.content).toBe("hello from A");

    expect(mockSetAgentStreaming).toHaveBeenCalledWith("ai-A", false);

    // Partition send-control for A is no longer in-flight.
    expect(_peekPartitionSendControl("p-1:ai-A:fresh")?.inFlight).toBe(false);
  });

  it("Mid-stream switch with no second send: A still finalizes on its partition", async () => {
    const capture = setupSendStreamCapture();

    const { result, rerender } = renderHook(
      ({ projectId, agentInstanceId }) =>
        useChatStream({ projectId, agentInstanceId }),
      { initialProps: { projectId: "p-1", agentInstanceId: "ai-A" } },
    );

    await act(async () => {
      void result.current.sendMessage("hi from A");
      await Promise.resolve();
    });

    rerender({ projectId: "p-1", agentInstanceId: "ai-B" });

    const aHandler = capture.calls[0].handler;
    await act(async () => {
      aHandler.onEvent?.({
        type: EventType.TextDelta,
        content: { text: "A finishes alone" },
      } as AuraEvent);
      aHandler.onEvent?.({
        type: EventType.AssistantMessageEnd,
        content: { stop_reason: "end_turn" },
      } as AuraEvent);
      capture.calls[0].resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const aEntry = useStreamStore.getState().entries["p-1:ai-A:fresh"];
    expect(aEntry.isStreaming).toBe(false);
    const assistant = aEntry.events.find((e) => e.role === "assistant");
    expect(assistant?.content).toBe("A finishes alone");
    expect(mockSetAgentStreaming).toHaveBeenCalledWith("ai-A", false);
  });

  it("Two parallel hooks at distinct partitions can both send concurrently", async () => {
    const capture = setupSendStreamCapture();

    const { result: rA } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-A" }),
    );
    const { result: rB } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-B" }),
    );

    await act(async () => {
      void rA.current.sendMessage("from A");
      void rB.current.sendMessage("from B");
      await Promise.resolve();
    });

    expect(capture.calls).toHaveLength(2);
    const aCall = capture.calls.find((c) => c.agentInstanceId === "ai-A");
    const bCall = capture.calls.find((c) => c.agentInstanceId === "ai-B");
    expect(aCall?.content).toBe("from A");
    expect(bCall?.content).toBe("from B");

    const entries = useStreamStore.getState().entries;
    expect(entries["p-1:ai-A:fresh"]?.isStreaming).toBe(true);
    expect(entries["p-1:ai-B:fresh"]?.isStreaming).toBe(true);

    for (const c of capture.calls) c.resolve();
  });

  it("Auto-retry replays on the originating partition even after the panel swaps", async () => {
    vi.useFakeTimers();
    const capture = setupSendStreamCapture();

    // First send: synchronously surface a stream-dropped error via the
    // handler's onError so tryAutoRetry schedules a timer.
    capture.installHandler((call) => {
      if (call.agentInstanceId === "ai-A" && capture.calls.length === 1) {
        const err = Object.assign(new Error("stream lagged"), {
          code: "stream_lagged",
        });
        call.handler.onError?.(err);
        // Resolve so performSend's finally runs and the latch clears
        // before the retry timer fires.
        call.resolve();
      }
    });

    const { result, rerender } = renderHook(
      ({ projectId, agentInstanceId }) =>
        useChatStream({ projectId, agentInstanceId }),
      { initialProps: { projectId: "p-1", agentInstanceId: "ai-A" } },
    );

    await act(async () => {
      void result.current.sendMessage("retry me");
      await Promise.resolve();
      await Promise.resolve();
    });

    // The first POST happened on partition A.
    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0].agentInstanceId).toBe("ai-A");

    // User switches the panel to agent B before the retry timer fires.
    rerender({ projectId: "p-1", agentInstanceId: "ai-B" });
    await act(async () => {
      await Promise.resolve();
    });

    // Fast-forward past the 1s retry delay.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    // The retry POST must target the ORIGINATING partition (ai-A),
    // not the panel's currently-mounted one (ai-B).
    expect(capture.calls.length).toBeGreaterThanOrEqual(2);
    const retryCall = capture.calls[1];
    expect(retryCall.projectId).toBe("p-1");
    expect(retryCall.agentInstanceId).toBe("ai-A");
    expect(retryCall.content).toBe("retry me");

    // Cleanup outstanding promises.
    for (const c of capture.calls) c.resolve();
    vi.useRealTimers();
  });

  it("stopStreaming aborts the AbortSignal that was wired into the in-flight SSE fetch", async () => {
    // Regression: after the per-partition send-control refactor, the
    // controller actually passed to `api.sendEventStream` lives on
    // `partitionSendControlMap[key].currentController`, not on
    // `streamMetaMap[key].abort`. `core.baseStopStreaming()` only
    // aborts the latter, so for chat sends the SSE reader never saw
    // a real abort and Stop became a no-op. This test pins the wiring
    // so the regression cannot return silently.
    const capture = setupSendStreamCapture();

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-A" }),
    );

    await act(async () => {
      void result.current.sendMessage("please stop me");
      await Promise.resolve();
    });

    expect(capture.calls).toHaveLength(1);
    const sentSignal = capture.calls[0].signal;
    expect(sentSignal).toBeDefined();
    expect(sentSignal!.aborted).toBe(false);
    expect(useStreamStore.getState().entries["p-1:ai-A:fresh"]?.isStreaming).toBe(
      true,
    );

    await act(async () => {
      result.current.stopStreaming();
      await Promise.resolve();
    });

    expect(sentSignal!.aborted).toBe(true);
    expect(useStreamStore.getState().entries["p-1:ai-A:fresh"]?.isStreaming).toBe(
      false,
    );
    expect(_peekPartitionSendControl("p-1:ai-A:fresh")?.currentController).toBeNull();

    // Resolve the captured promise so the test doesn't leak it; in real
    // code the AbortError from `streamSSE` would reject this for us.
    capture.calls[0].resolve();
  });
});

// Phase 4 (parallel-session-chats plan): the lane is keyed by
// `(projectId, agentInstanceId, sessionId ?? FRESH_SESSION_PLACEHOLDER)`
// so the same agent instance can carry truly concurrent turns on two
// different storage sessions. These tests pin the per-session
// isolation that makes that possible — view-no-leak, concurrent
// dispatch, and independent completion.
describe("useChatStream same instance, parallel sessions", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    useChatUIStore.setState({ streams: {} });
    useSessionsListStore.setState({
      sessionsBySurface: {},
      loadingBySurface: {},
      deleteErrorBySurface: {},
      version: 0,
    });
    _resetAllPartitionSendControl();
    vi.clearAllMocks();
    vi.mocked(api.sendEventStream).mockReset().mockResolvedValue(undefined);
  });

  it("view-no-leak: sending on session A leaves session B's lane untouched", async () => {
    const capture = setupSendStreamCapture();

    const { result: rA } = renderHook(() =>
      useChatStream({
        projectId: "p-1",
        agentInstanceId: "ai-X",
        sessionId: "s-1",
      }),
    );
    const { result: rB } = renderHook(() =>
      useChatStream({
        projectId: "p-1",
        agentInstanceId: "ai-X",
        sessionId: "s-2",
      }),
    );

    const keyA = keyForProjectSession("p-1", "ai-X", "s-1");
    const keyB = keyForProjectSession("p-1", "ai-X", "s-2");
    expect(keyA).not.toBe(keyB);

    await act(async () => {
      void rA.current.sendMessage("hi from A");
      await Promise.resolve();
    });

    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0].agentInstanceId).toBe("ai-X");
    expect(capture.calls[0].content).toBe("hi from A");

    const entries = useStreamStore.getState().entries;
    expect(entries[keyA]?.isStreaming).toBe(true);
    expect(entries[keyB]?.isStreaming ?? false).toBe(false);
    // B's transcript / event buffer hasn't been touched.
    expect(entries[keyB]?.events ?? []).toHaveLength(0);
    expect(entries[keyB]?.streamingText ?? "").toBe("");

    // No POST went out for B.
    expect(
      capture.calls.filter((c) => c.content === "hi from A"),
    ).toHaveLength(1);
    expect(capture.calls.some((c) => c.content !== "hi from A")).toBe(false);

    // Per-session send-control entries are independent: A's lane is
    // in flight, B's lane (lazy-created by the hook's mount effect
    // because it has a pinned sessionId, see `useChatStream`'s
    // `getPartitionSendControl(core.key)` call) is still idle.
    const ctlA = _peekPartitionSendControl(keyA);
    const ctlB = _peekPartitionSendControl(keyB);
    expect(ctlA?.inFlight).toBe(true);
    expect(ctlA?.currentController).not.toBeNull();
    expect(ctlB?.inFlight ?? false).toBe(false);
    expect(ctlB?.currentController ?? null).toBeNull();
    expect(ctlA).not.toBe(ctlB);

    capture.calls[0].resolve();
  });

  it("concurrent-sends: parallel sendMessage on two sessions take distinct lanes", async () => {
    const capture = setupSendStreamCapture();

    const { result: rA } = renderHook(() =>
      useChatStream({
        projectId: "p-1",
        agentInstanceId: "ai-X",
        sessionId: "s-1",
      }),
    );
    const { result: rB } = renderHook(() =>
      useChatStream({
        projectId: "p-1",
        agentInstanceId: "ai-X",
        sessionId: "s-2",
      }),
    );

    const keyA = keyForProjectSession("p-1", "ai-X", "s-1");
    const keyB = keyForProjectSession("p-1", "ai-X", "s-2");

    await act(async () => {
      // Concurrent dispatch via `Promise.all`. The underlying
      // `api.sendEventStream` mock returns a hanging promise that we
      // resolve manually at the end of the test, so we can't `await`
      // the all-promise without deadlocking — `void` it and let the
      // microtask flush below settle the synchronous send paths.
      void Promise.all([
        rA.current.sendMessage("from A"),
        rB.current.sendMessage("from B"),
      ]);
      await Promise.resolve();
    });

    // Two distinct dispatcher calls — no merging into one POST.
    expect(capture.calls).toHaveLength(2);
    const aCall = capture.calls.find((c) => c.content === "from A");
    const bCall = capture.calls.find((c) => c.content === "from B");
    expect(aCall).toBeDefined();
    expect(bCall).toBeDefined();
    expect(aCall!.agentInstanceId).toBe("ai-X");
    expect(bCall!.agentInstanceId).toBe("ai-X");

    // Each lane is streaming on its own key.
    const entries = useStreamStore.getState().entries;
    expect(entries[keyA]?.isStreaming).toBe(true);
    expect(entries[keyB]?.isStreaming).toBe(true);

    // Independent abort signals on the wire.
    expect(aCall!.signal).toBeDefined();
    expect(bCall!.signal).toBeDefined();
    expect(aCall!.signal).not.toBe(bCall!.signal);
    expect(aCall!.signal!.aborted).toBe(false);
    expect(bCall!.signal!.aborted).toBe(false);

    // Independent per-session send-control entries, each holding their
    // own (distinct) AbortController.
    const ctlA = _peekPartitionSendControl(keyA);
    const ctlB = _peekPartitionSendControl(keyB);
    expect(ctlA).toBeDefined();
    expect(ctlB).toBeDefined();
    expect(ctlA).not.toBe(ctlB);
    expect(ctlA!.currentController).not.toBeNull();
    expect(ctlB!.currentController).not.toBeNull();
    expect(ctlA!.currentController).not.toBe(ctlB!.currentController);
    expect(ctlA!.inFlight).toBe(true);
    expect(ctlB!.inFlight).toBe(true);

    for (const c of capture.calls) c.resolve();
  });

  it("independent-completion: terminating A leaves B streaming", async () => {
    const capture = setupSendStreamCapture();

    const { result: rA } = renderHook(() =>
      useChatStream({
        projectId: "p-1",
        agentInstanceId: "ai-X",
        sessionId: "s-1",
      }),
    );
    const { result: rB } = renderHook(() =>
      useChatStream({
        projectId: "p-1",
        agentInstanceId: "ai-X",
        sessionId: "s-2",
      }),
    );

    const keyA = keyForProjectSession("p-1", "ai-X", "s-1");
    const keyB = keyForProjectSession("p-1", "ai-X", "s-2");

    await act(async () => {
      void rA.current.sendMessage("hi A");
      void rB.current.sendMessage("hi B");
      await Promise.resolve();
    });

    expect(capture.calls).toHaveLength(2);
    const aCall = capture.calls.find((c) => c.content === "hi A")!;
    const bCall = capture.calls.find((c) => c.content === "hi B")!;

    // Both lanes streaming up front.
    let entries = useStreamStore.getState().entries;
    expect(entries[keyA]?.isStreaming).toBe(true);
    expect(entries[keyB]?.isStreaming).toBe(true);

    // Drive A's stream to a clean assistant end. B is untouched.
    await act(async () => {
      aCall.handler.onEvent?.({
        type: EventType.TextDelta,
        content: { text: "done A" },
      } as AuraEvent);
      aCall.handler.onEvent?.({
        type: EventType.AssistantMessageEnd,
        content: { stop_reason: "end_turn" },
      } as AuraEvent);
      aCall.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    entries = useStreamStore.getState().entries;
    expect(entries[keyA]?.isStreaming).toBe(false);
    // No cross-completion: B's lane is still in flight.
    expect(entries[keyB]?.isStreaming).toBe(true);

    // B's events buffer did NOT receive A's TextDelta or assistant
    // turn boundary. It should still hold just B's own user bubble.
    const bAssistant = (entries[keyB]?.events ?? []).find(
      (e) => e.role === "assistant",
    );
    expect(bAssistant).toBeUndefined();

    bCall.resolve();
  });
});
