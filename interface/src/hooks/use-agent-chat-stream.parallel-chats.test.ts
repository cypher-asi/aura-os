import { renderHook, act } from "@testing-library/react";
import { useAgentChatStream } from "./use-agent-chat-stream";
import {
  useStreamStore,
  streamMetaMap,
  keyForAgentSession,
} from "./stream/store";
import { useChatUIStore } from "../stores/chat-ui-store";
import { useSessionsListStore } from "../stores/sessions-list-store";
import { useMessageQueueStore } from "../stores/message-queue-store";
import { EventType, type AuraEvent } from "../shared/types/aura-events";
import type { StreamEventHandler } from "../api/streams";

// `useAgentChatStream` doesn't depend on the project chat surfaces'
// sidekick/projectActions stores, so this mock set is intentionally
// slimmer than `use-chat-stream/parallel-chats.test.ts`. We mock the
// outbound dispatcher (`api.agents.sendEventStream`) plus the
// generation streams so the hook's send path is exercised end-to-end
// without any real network.
vi.mock("../api/client", () => ({
  api: {
    agents: {
      sendEventStream: vi.fn().mockResolvedValue(undefined),
    },
  },
  isInsufficientCreditsError: vi.fn(() => false),
  isAgentBusyError: vi.fn(() => null),
  isHarnessCapacityExhaustedError: vi.fn(() => null),
  dispatchInsufficientCredits: vi.fn(),
}));

vi.mock("../api/streams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/streams")>();
  return {
    ...actual,
    generateImageStream: vi.fn().mockResolvedValue(undefined),
    generate3dStream: vi.fn().mockResolvedValue(undefined),
    generateVideoStream: vi.fn().mockResolvedValue(undefined),
  };
});

import { api } from "../api/client";

interface CapturedAgentSendCall {
  agentId: string;
  content: string;
  action: string | null;
  handler: StreamEventHandler;
  signal: AbortSignal | undefined;
  resolve: () => void;
  reject: (err: unknown) => void;
}

function setupAgentSendStreamCapture(): {
  calls: CapturedAgentSendCall[];
  reset: () => void;
} {
  const calls: CapturedAgentSendCall[] = [];
  vi.mocked(api.agents.sendEventStream).mockImplementation(
    (
      agentId,
      content,
      action,
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
      calls.push({
        agentId: agentId as string,
        content,
        action,
        handler: handler as StreamEventHandler,
        signal,
        resolve,
        reject,
      });
      return promise;
    },
  );
  return {
    calls,
    reset: () => {
      calls.length = 0;
    },
  };
}

// Phase 4 (parallel-session-chats plan): standalone agent chat is
// keyed by `(agentId, sessionId ?? "fresh")` so the same agent
// template can carry truly concurrent turns on two different storage
// sessions. These tests mirror the project-chat parallel-sessions
// coverage in `use-chat-stream/parallel-chats.test.ts`.
describe("useAgentChatStream same instance, parallel sessions", () => {
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
    useMessageQueueStore.setState({ queues: {} });
    vi.clearAllMocks();
    vi.mocked(api.agents.sendEventStream)
      .mockReset()
      .mockResolvedValue(undefined);
  });

  it("view-no-leak: sending on session A leaves session B's lane untouched", async () => {
    const capture = setupAgentSendStreamCapture();

    const { result: rA } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-x", sessionId: "s-1" }),
    );
    const { result: rB } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-x", sessionId: "s-2" }),
    );

    const keyA = keyForAgentSession("agent-x", "s-1");
    const keyB = keyForAgentSession("agent-x", "s-2");
    expect(keyA).not.toBe(keyB);

    await act(async () => {
      void rA.current.sendMessage("hi from A");
      await Promise.resolve();
    });

    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0].agentId).toBe("agent-x");
    expect(capture.calls[0].content).toBe("hi from A");

    const entries = useStreamStore.getState().entries;
    expect(entries[keyA]?.isStreaming).toBe(true);
    expect(entries[keyB]?.isStreaming ?? false).toBe(false);
    // B's transcript / event buffer hasn't been touched.
    expect(entries[keyB]?.events ?? []).toHaveLength(0);
    expect(entries[keyB]?.streamingText ?? "").toBe("");

    // No POST went out for B.
    expect(capture.calls.some((c) => c.content !== "hi from A")).toBe(false);

    capture.calls[0].resolve();
  });

  it("concurrent-sends: parallel sendMessage on two sessions take distinct lanes", async () => {
    const capture = setupAgentSendStreamCapture();

    const { result: rA } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-x", sessionId: "s-1" }),
    );
    const { result: rB } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-x", sessionId: "s-2" }),
    );

    const keyA = keyForAgentSession("agent-x", "s-1");
    const keyB = keyForAgentSession("agent-x", "s-2");

    await act(async () => {
      // Concurrent dispatch via `Promise.all`. The mocked send returns
      // a hanging promise we resolve manually below, so `void` the
      // all-promise instead of `await`ing it.
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
    expect(aCall!.agentId).toBe("agent-x");
    expect(bCall!.agentId).toBe("agent-x");

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

    // Independent abort controllers stored on the per-key stream meta.
    const metaA = streamMetaMap.get(keyA);
    const metaB = streamMetaMap.get(keyB);
    expect(metaA?.abort).not.toBeNull();
    expect(metaB?.abort).not.toBeNull();
    expect(metaA!.abort).not.toBe(metaB!.abort);

    for (const c of capture.calls) c.resolve();
  });

  it("independent-completion: terminating A leaves B streaming", async () => {
    const capture = setupAgentSendStreamCapture();

    const { result: rA } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-x", sessionId: "s-1" }),
    );
    const { result: rB } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-x", sessionId: "s-2" }),
    );

    const keyA = keyForAgentSession("agent-x", "s-1");
    const keyB = keyForAgentSession("agent-x", "s-2");

    await act(async () => {
      void rA.current.sendMessage("hi A");
      void rB.current.sendMessage("hi B");
      await Promise.resolve();
    });

    expect(capture.calls).toHaveLength(2);
    const aCall = capture.calls.find((c) => c.content === "hi A")!;
    const bCall = capture.calls.find((c) => c.content === "hi B")!;

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
