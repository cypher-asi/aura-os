import { renderHook, act } from "@testing-library/react";
import { useAgentChatStream } from "./use-agent-chat-stream";
import { useStreamStore, streamMetaMap } from "./stream/store";
import { useChatUIStore } from "../stores/chat-ui-store";
import { useMessageQueueStore } from "../stores/message-queue-store";
import { useContextUsageStore } from "../stores/context-usage-store";
import { STUCK_THRESHOLD_MS } from "./stream/use-stream-health";
import { STYLE_LOCK_SUFFIX } from "../constants/generation";
import { EventType, type AuraEvent } from "../shared/types/aura-events";

vi.mock("../api/client", () => ({
  api: {
    agents: {
      sendEventStream: vi.fn().mockResolvedValue(undefined),
      cancelTurn: vi.fn().mockResolvedValue(undefined),
    },
  },
  isInsufficientCreditsError: vi.fn(() => false),
  isAgentBusyError: vi.fn(() => null),
  isHarnessCapacityExhaustedError: vi.fn(() => null),
  dispatchInsufficientCredits: vi.fn(),
}));

vi.mock("../api/streams", () => ({
  generateImageStream: vi.fn().mockResolvedValue(undefined),
  generate3dStream: vi.fn().mockResolvedValue(undefined),
  generateVideoStream: vi.fn().mockResolvedValue(undefined),
}));

import { api } from "../api/client";
import {
  generate3dStream,
  generateImageStream,
  generateVideoStream,
} from "../api/streams";

describe("useAgentChatStream", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    useChatUIStore.setState({ streams: {} });
    useMessageQueueStore.setState({ queues: {} });
    useContextUsageStore.setState({
      usageByStreamKey: {},
      utilPerTokenByStreamKey: {},
      resetPendingByStreamKey: {},
    });
    vi.mocked(api.agents.sendEventStream).mockReset().mockResolvedValue(undefined);
    vi.mocked(generateImageStream).mockReset().mockResolvedValue(undefined);
    vi.mocked(generate3dStream).mockReset().mockResolvedValue(undefined);
    vi.mocked(generateVideoStream).mockReset().mockResolvedValue(undefined);
  });

  it("returns streamKey, sendMessage, stopStreaming, resetEvents", () => {
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    expect(result.current.streamKey).toBeTruthy();
    expect(typeof result.current.sendMessage).toBe("function");
    expect(typeof result.current.stopStreaming).toBe("function");
    expect(typeof result.current.resetEvents).toBe("function");
  });

  it("sends a message and creates a user message in the store", async () => {
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(api.agents.sendEventStream).toHaveBeenCalled();
    const entry = useStreamStore.getState().entries[result.current.streamKey];
    expect(entry.events.length).toBeGreaterThanOrEqual(1);
    expect(entry.events[0].role).toBe("user");
    expect(entry.events[0].content).toBe("hello");
  });

  it("routes image generation through the dedicated image stream", async () => {
    const attachments = [
      {
        type: "image" as const,
        media_type: "image/png",
        data: "abc123",
        name: "reference.png",
      },
    ];
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "draw a fox",
        null,
        "gpt-image-2",
        attachments,
        ["generate_image"],
        "p-1",
        "image",
      );
    });

    expect(api.agents.sendEventStream).not.toHaveBeenCalled();
    expect(
      useStreamStore.getState().entries[result.current.streamKey]?.progressText,
    ).toBe("Generating image...");
    expect(generateImageStream).toHaveBeenCalledWith(
      "draw a fox",
      "gpt-image-2",
      attachments,
      expect.any(Object),
      expect.any(AbortSignal),
      // Standalone agent chat must forward `agentId` so the server can
      // resolve the agent's chat session and persist this turn into
      // history (otherwise it lives only in the in-memory stream store
      // and disappears on hard reload).
      { agentId: "agent-1", projectId: "p-1" },
      // No `markNextSendAsNewSession` was called and no `?session=`
      // pin was passed to the hook, so both flags fall through as
      // their resting "no override" values.
      false,
      null,
    );
  });

  it("persists completed image generation as a generated image tool card", async () => {
    vi.mocked(generateImageStream).mockImplementation(
      async (_prompt, _model, _attachments, handler) => {
        handler?.onEvent({
          type: EventType.GenerationCompleted,
          content: {
            mode: "image",
            imageUrl: "https://cdn.example.com/cat.png",
            originalUrl: "https://cdn.example.com/cat-original.png",
            artifactId: "artifact-cat",
          },
        } as any);
      },
    );

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "draw a cat",
        null,
        "gpt-image-2",
        undefined,
        ["generate_image"],
        "p-1",
        "image",
      );
    });

    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const assistantEvent = entry.events.find((event) => event.role === "assistant");
    const imageTool = assistantEvent?.toolCalls?.find((tool) => tool.name === "generate_image");

    expect(imageTool).toMatchObject({
      pending: false,
      isError: false,
    });
    expect(JSON.parse(imageTool?.result ?? "{}")).toMatchObject({
      imageUrl: "https://cdn.example.com/cat.png",
      artifactId: "artifact-cat",
    });
    expect(entry.activeToolCalls).toHaveLength(0);
  });

  it("3D image step: routes a no-pin send through generateImageStream with the AURA style suffix and pins the result", async () => {
    vi.mocked(generateImageStream).mockImplementation(
      async (_prompt, _model, _attachments, handler) => {
        handler?.onEvent({
          type: EventType.GenerationCompleted,
          content: {
            mode: "image",
            imageUrl: "https://cdn.example.com/eagle.png",
            originalUrl: "https://cdn.example.com/eagle-orig.png",
            artifactId: "artifact-eagle",
          },
        } as AuraEvent);
      },
    );

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "an eagle",
        null,
        "tripo-v2",
        undefined,
        ["generate_3d"],
        "p-1",
        "3d",
        undefined,
      );
    });

    expect(api.agents.sendEventStream).not.toHaveBeenCalled();
    expect(generate3dStream).not.toHaveBeenCalled();
    expect(generateImageStream).toHaveBeenCalledWith(
      `an eagle${STYLE_LOCK_SUFFIX}`,
      expect.any(String),
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      { agentId: "agent-1", projectId: "p-1" },
      false,
      null,
    );
    const pinned = useChatUIStore
      .getState()
      .getPinnedSourceImage(result.current.streamKey);
    expect(pinned).toEqual({
      imageUrl: "https://cdn.example.com/eagle.png",
      originalUrl: "https://cdn.example.com/eagle-orig.png",
      prompt: "an eagle",
    });
  });

  it("3D model step: routes a pinned-image send through generate3dStream and clears the pin on completion", async () => {
    vi.mocked(generate3dStream).mockImplementation(
      async (_image, _prompt, handler) => {
        handler?.onEvent({
          type: EventType.GenerationCompleted,
          content: {
            mode: "3d",
            glbUrl: "https://cdn.example.com/eagle.glb",
            artifactId: "artifact-eagle-3d",
          },
        } as AuraEvent);
      },
    );

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    act(() => {
      useChatUIStore.getState().setPinnedSourceImage(result.current.streamKey, {
        imageUrl: "https://cdn.example.com/owl.png",
        originalUrl: "https://cdn.example.com/owl-orig.png",
        prompt: "an owl",
      });
    });

    await act(async () => {
      await result.current.sendMessage(
        "make it brass",
        null,
        "tripo-v2",
        undefined,
        ["generate_3d"],
        "p-1",
        "3d",
        "https://cdn.example.com/owl.png",
      );
    });

    expect(api.agents.sendEventStream).not.toHaveBeenCalled();
    expect(generateImageStream).not.toHaveBeenCalled();
    expect(generate3dStream).toHaveBeenCalledWith(
      { kind: "url", imageUrl: "https://cdn.example.com/owl.png" },
      "make it brass",
      expect.any(Object),
      expect.any(AbortSignal),
      "p-1",
      undefined,
      "agent-1",
      undefined,
      false,
      null,
    );
    const pinned = useChatUIStore
      .getState()
      .getPinnedSourceImage(result.current.streamKey);
    expect(pinned).toBeNull();

    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const assistantEvent = entry.events.find((evt) => evt.role === "assistant");
    const modelTool = assistantEvent?.toolCalls?.find(
      (tool) => tool.name === "generate_3d_model",
    );
    expect(modelTool).toMatchObject({ pending: false, isError: false });
    expect(JSON.parse(modelTool?.result ?? "{}")).toMatchObject({
      glbUrl: "https://cdn.example.com/eagle.glb",
    });
    expect(entry.activeToolCalls).toHaveLength(0);
  });

  it("3D model step: image-only send (no text) still dispatches through generate3dStream", async () => {
    // Regression: the input bar enables Send when only a source image
    // is pinned (no text), but `sendMessage` used to share the
    // empty-content guard with chat mode and would silently no-op the
    // call. The 3D model step bypasses the guard whenever
    // `_generationMode === "3d"` and `_sourceImageUrl` is set.
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "",
        null,
        "tripo-v2",
        undefined,
        ["generate_3d"],
        "p-1",
        "3d",
        "https://cdn.example.com/owl.png",
      );
    });

    expect(generate3dStream).toHaveBeenCalledWith(
      { kind: "url", imageUrl: "https://cdn.example.com/owl.png" },
      null,
      expect.any(Object),
      expect.any(AbortSignal),
      "p-1",
      undefined,
      "agent-1",
      undefined,
      false,
      null,
    );
    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const userMsg = entry.events.find((evt) => evt.role === "user");
    expect(userMsg?.content).toBe("Generate 3D model");
  });

  it("does nothing when agentId is undefined", async () => {
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: undefined }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(api.agents.sendEventStream).not.toHaveBeenCalled();
  });

  it("does nothing for empty message without action", async () => {
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("   ");
    });

    expect(api.agents.sendEventStream).not.toHaveBeenCalled();
  });

  it("handles stream errors gracefully", async () => {
    vi.mocked(api.agents.sendEventStream).mockRejectedValue(new Error("connection lost"));

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const entry = useStreamStore.getState().entries[result.current.streamKey];
    // Error string is now routed through the dedicated
    // `errorMessage` field (rendered inline in the action row by
    // `MessageBubble`) instead of being concatenated into
    // `content`, so the lookup matches on the new field.
    const errorMsg = entry.events.find((m) =>
      (m.errorMessage ?? "").toLowerCase().includes("connection lost"),
    );
    expect(errorMsg).toBeTruthy();
  });

  it("calls onTaskSaved callback", async () => {
    const onTaskSaved = vi.fn();
    vi.mocked(api.agents.sendEventStream).mockImplementation(
      async (_id, _content, _action, _model, _attachments, handler) => {
        handler?.onEvent({
          type: EventType.TaskSaved,
          content: {
            task: {
              task_id: "t-1",
              project_id: "p-1",
              spec_id: "s-1",
              title: "Test",
              description: "",
              status: "pending",
              order_index: 0,
              dependency_ids: [],
              parent_task_id: null,
              assigned_agent_instance_id: null,
              completed_by_agent_instance_id: null,
              session_id: null,
              execution_notes: "",
              files_changed: [],
              live_output: "",
              total_input_tokens: 0,
              total_output_tokens: 0,
              created_at: "",
              updated_at: "",
            },
          },
        } as any);
      },
    );

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1", onTaskSaved }),
    );

    await act(async () => {
      await result.current.sendMessage("do work");
    });

    expect(onTaskSaved).toHaveBeenCalled();
  });

  it("ignores AbortError when stream is cancelled", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    vi.mocked(api.agents.sendEventStream).mockRejectedValue(abortError);

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const errorMsgs = entry.events.filter((m) => m.content.includes("Error"));
    expect(errorMsgs).toHaveLength(0);
  });

  it("blocks a second sendMessage that races inside the same microtask before the first awaits", async () => {
    // Regression: on the CEO's first chat the server-side
    // `lazy_repair_home_project_binding` makes `send_agent_event_stream`
    // hang for several seconds before the first SSE byte arrives, so the
    // chat panel sits silent. If a user double-clicks Send (or Enter twice)
    // both calls used to read `getIsStreaming` as `false` before either
    // had time to write `true` through Zustand, and two parallel POSTs
    // would fire — manifesting in the UI as "the first chat with the CEO
    // streams twice." The synchronous in-flight ref must short-circuit
    // the second call regardless of whether the Zustand store has caught up.
    let resolveFirstStream: (() => void) | null = null;
    vi.mocked(api.agents.sendEventStream).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstStream = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      const firstSend = result.current.sendMessage("hello");
      // Kick off the second send in the same synchronous tick the first
      // is mid-await. Without the latch both pass the streaming guard.
      const secondSend = result.current.sendMessage("hello again");
      resolveFirstStream?.();
      await Promise.all([firstSend, secondSend]);
    });

    expect(api.agents.sendEventStream).toHaveBeenCalledTimes(1);
    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const userMessages = entry.events.filter((evt) => evt.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe("hello");
  });

  it("queues a second message into useMessageQueueStore when the entry is already streaming", async () => {
    // Phase 1 fix: a sendMessage that arrives while
    // `getIsStreaming(key)` is true must enqueue into
    // `useMessageQueueStore` rather than vanish silently. The
    // dequeue-on-completion effect in `useChatPanelState` then
    // replays the queued message when the live turn finalizes.
    //
    // We seed `isStreaming=true` directly on the store entry so the
    // queue branch is the only one the new send can take. Driving
    // it through a real first `sendMessage` would also leave
    // `inFlightRef.current=true` for the same hook instance, and
    // that synchronous latch fires before the queue branch (it's
    // there to swallow same-microtask re-entries).
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    const key = result.current.streamKey;
    act(() => {
      useStreamStore.setState((s) => ({
        entries: {
          ...s.entries,
          [key]: {
            isStreaming: true,
            isWriting: false,
            events: [],
            streamingText: "",
            thinkingText: "",
            thinkingDurationMs: null,
            activeToolCalls: [],
            timeline: [],
            progressText: "",
            lastEventAt: Date.now(),
            stuckSince: null,
          },
        },
      }));
    });

    await act(async () => {
      await result.current.sendMessage("queue me");
    });

    expect(api.agents.sendEventStream).not.toHaveBeenCalled();
    const queue = useMessageQueueStore.getState().queues[key] ?? [];
    expect(queue).toHaveLength(1);
    expect(queue[0].content).toBe("queue me");
    expect(queue[0].pendingDueToStuckStream).toBe(false);
  });

  it("clears the in-flight latch in sync with setIsStreaming(false) from AssistantMessageEnd so a queued dequeue can re-enter immediately", async () => {
    // Regression for the "queued prompts disappear" bug: when the
    // server emits `AssistantMessageEnd` mid-stream, the handler
    // flips `isStreaming` to `false` while the outer async
    // `sendMessage` is still awaiting the SSE close. The dequeue
    // effect in `useChatPanelState` fires on the `isStreaming`
    // transition and re-enters `sendMessage`. Before the fix the
    // synchronous `inFlightRef` latch was still set and the second
    // call returned silently, dropping the queued message.
    let releaseFirstStream: (() => void) | null = null;
    const firstStreamClosed = new Promise<void>((resolve) => {
      releaseFirstStream = resolve;
    });
    let callIndex = 0;

    vi.mocked(api.agents.sendEventStream).mockImplementation(
      async (_id, _content, _action, _model, _attachments, handler) => {
        const isFirstCall = callIndex === 0;
        callIndex += 1;
        if (isFirstCall) {
          // Emit AssistantMessageEnd (which flips isStreaming false
          // and — with the fix — clears the in-flight latch) but
          // keep the outer async fn parked on `firstStreamClosed`
          // so its `finally` block hasn't run yet when we re-enter.
          handler?.onEvent({
            type: EventType.AssistantMessageEnd,
            content: { stop_reason: "stop" },
          } as AuraEvent);
          await firstStreamClosed;
        }
      },
    );

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    const firstSend = result.current.sendMessage("first");
    // Yield so the mocked handler emits AssistantMessageEnd before
    // we re-enter `sendMessage`.
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.sendMessage("second");
    });

    // Both messages should reach the wire: the fix clears
    // `inFlightRef` from inside the AssistantMessageEnd handler so
    // the dequeue-style re-entry isn't swallowed by the in-flight
    // guard at the top of `sendMessage`.
    expect(api.agents.sendEventStream).toHaveBeenCalledTimes(2);
    const userBubblesByContent = vi
      .mocked(api.agents.sendEventStream)
      .mock.calls.map((call) => call[1]);
    expect(userBubblesByContent).toEqual(["first", "second"]);

    releaseFirstStream?.();
    await act(async () => {
      await firstSend;
    });
  });

  it("stopStreaming clears the in-flight latch synchronously so a follow-up sendMessage in the same tick lands on the wire", async () => {
    // Regression for the "Send now" force-send: clicking the queue
    // affordance calls `stopStreaming` and immediately dispatches
    // the chosen prompt. Before the fix, `stopStreaming` only
    // aborted the controller and the in-flight latch was reset
    // from the outer async fn's `finally` block — which fires in
    // a microtask AFTER the synchronous follow-up `sendMessage`,
    // so the force-send was silently dropped by the re-entry guard.
    let releaseFirstStream: (() => void) | null = null;
    const firstStreamClosed = new Promise<void>((resolve) => {
      releaseFirstStream = resolve;
    });
    let callIndex = 0;

    vi.mocked(api.agents.sendEventStream).mockImplementation(
      async (_id, _content, _action, _model, _attachments, _handler, signal) => {
        const isFirstCall = callIndex === 0;
        callIndex += 1;
        if (isFirstCall) {
          // Park the first send so its `finally` hasn't run by the
          // time the test triggers stop + send-now.
          await new Promise<void>((resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
            firstStreamClosed.then(resolve);
          });
        }
      },
    );

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    const firstSend = result.current.sendMessage("first");
    // Let the first send register its in-flight latch + push the
    // user bubble.
    await act(async () => {
      await Promise.resolve();
    });

    // Stop the in-flight turn AND fire a follow-up send in the same
    // synchronous tick — the exact pattern `handleQueueSendNow`
    // produces.
    let secondSend: Promise<void> | undefined;
    act(() => {
      result.current.stopStreaming();
      secondSend = result.current.sendMessage("force-sent");
    });

    await act(async () => {
      await secondSend;
    });

    // The force-sent message must have reached the wire even
    // though the first turn's `finally` hasn't fired yet.
    expect(api.agents.sendEventStream).toHaveBeenCalledTimes(2);
    const wirePayloads = vi
      .mocked(api.agents.sendEventStream)
      .mock.calls.map((call) => call[1]);
    expect(wirePayloads).toEqual(["first", "force-sent"]);

    releaseFirstStream?.();
    await act(async () => {
      await firstSend;
    });
  });

  it("marks the queued message as pendingDueToStuckStream when the entry's last wire event is older than STUCK_THRESHOLD_MS", async () => {
    // Same scenario as above, but the in-flight turn has gone
    // silent past the stuck threshold. The message still gets
    // queued (no silent drop), and `pendingDueToStuckStream=true`
    // so the Phase 2 banner can offer "Send anyway".
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    const key = result.current.streamKey;
    const stale = Date.now() - (STUCK_THRESHOLD_MS + 5_000);
    act(() => {
      useStreamStore.setState((s) => ({
        entries: {
          ...s.entries,
          [key]: {
            isStreaming: true,
            isWriting: false,
            events: [],
            streamingText: "",
            thinkingText: "",
            thinkingDurationMs: null,
            activeToolCalls: [],
            timeline: [],
            progressText: "",
            lastEventAt: stale,
            stuckSince: null,
          },
        },
      }));
    });

    await act(async () => {
      await result.current.sendMessage("send anyway please");
    });

    const queue = useMessageQueueStore.getState().queues[key] ?? [];
    expect(queue).toHaveLength(1);
    expect(queue[0].content).toBe("send anyway please");
    expect(queue[0].pendingDueToStuckStream).toBe(true);
  });

  it("populates context_breakdown into useContextUsageStore on AssistantMessageEnd", async () => {
    // Regression: the standalone agent chat / Chat-app surface used to
    // drop `usage.context_breakdown` on the floor, so the Context
    // popover never rendered the rich per-bucket panel even when the
    // harness emitted the field. The handler now mirrors
    // `build-stream-handler.ts` and forwards the breakdown into the
    // store via `mapWireContextBreakdown` so both chat surfaces show
    // the same UI.
    vi.mocked(api.agents.sendEventStream).mockImplementation(
      async (_id, _content, _action, _model, _attachments, handler) => {
        handler?.onEvent({
          type: EventType.AssistantMessageEnd,
          content: {
            stop_reason: "stop",
            usage: {
              context_utilization: 0.5,
              estimated_context_tokens: 100_000,
              context_breakdown: {
                system_prompt_tokens: 5_000,
                tools_tokens: 20_000,
                skills_tokens: 1_500,
                mcp_tokens: 0,
                subagents_tokens: 800,
                conversation_tokens: 72_700,
              },
            },
          },
        } as AuraEvent);
      },
    );

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hi");
    });

    const entry =
      useContextUsageStore.getState().usageByStreamKey[result.current.streamKey];
    expect(entry?.utilization).toBeCloseTo(0.5);
    expect(entry?.estimatedTokens).toBe(100_000);
    expect(entry?.breakdown).toEqual({
      systemPromptTokens: 5_000,
      toolsTokens: 20_000,
      skillsTokens: 1_500,
      mcpTokens: 0,
      subagentsTokens: 800,
      conversationTokens: 72_700,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it("bumps estimated tokens during streaming text/thinking/tool deltas so the Context ring moves mid-turn", async () => {
    // Regression: standalone agent chat used to freeze the Context
    // ring between authoritative `AssistantMessageEnd` events because
    // the three delta paths (TextDelta / ThinkingDelta / ToolResult)
    // didn't call `bumpEstimatedTokens`. The handler now mirrors
    // `build-stream-handler.ts`.
    vi.mocked(api.agents.sendEventStream).mockImplementation(
      async (_id, _content, _action, _model, _attachments, handler) => {
        handler?.onEvent({
          type: EventType.TextDelta,
          content: { text: "hello world" },
        } as AuraEvent);
        handler?.onEvent({
          type: EventType.ThinkingDelta,
          content: { text: "musing" },
        } as AuraEvent);
        handler?.onEvent({
          type: EventType.ToolResult,
          content: {
            id: "tool-1",
            name: "read_file",
            result: "file contents here",
            is_error: false,
          },
        } as AuraEvent);
      },
    );

    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("inspect");
    });

    const entry =
      useContextUsageStore.getState().usageByStreamKey[result.current.streamKey];
    // hello world (11 chars) -> 3, musing (6) -> 2, file contents here (18) -> 5
    expect(entry?.estimatedTokens).toBe(3 + 2 + 5);
  });

  it("marks only the next send as a new session", async () => {
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    await act(async () => {
      await result.current.sendMessage("first");
      await result.current.sendMessage("second");
    });

    expect(api.agents.sendEventStream).toHaveBeenNthCalledWith(
      1,
      "agent-1",
      "first",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      undefined,
      true,
      // `sessionId` arg: `null` when no pin is requested (the hook
      // option `sessionId` defaults to undefined). Forwarded as the
      // 11th positional arg to `api.agents.sendEventStream`.
      null,
    );
    expect(api.agents.sendEventStream).toHaveBeenNthCalledWith(
      2,
      "agent-1",
      "second",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      undefined,
      false,
      null,
    );
  });

  // Regression: the chat-input "+" affordance must work in EVERY
  // mode, not just code/plan. Previously `markNextSendAsNewSession`
  // only forwarded `new_session: true` on the regular chat
  // (`api.agents.sendEventStream`) path; image / 3D / video sends
  // silently appended to the latest existing session.
  it("forwards new-session flag to image generation", async () => {
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    await act(async () => {
      await result.current.sendMessage(
        "draw a fox",
        null,
        "gpt-image-2",
        undefined,
        ["generate_image"],
        "p-1",
        "image",
      );
    });

    expect(generateImageStream).toHaveBeenCalledWith(
      "draw a fox",
      "gpt-image-2",
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      { agentId: "agent-1", projectId: "p-1" },
      true,
      null,
    );
  });

  it("forwards new-session flag to the 3D image step", async () => {
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    await act(async () => {
      await result.current.sendMessage(
        "an eagle",
        null,
        "tripo-v2",
        undefined,
        ["generate_3d"],
        "p-1",
        "3d",
        undefined,
      );
    });

    expect(generateImageStream).toHaveBeenCalledWith(
      `an eagle${STYLE_LOCK_SUFFIX}`,
      expect.any(String),
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      { agentId: "agent-1", projectId: "p-1" },
      true,
      null,
    );
  });

  it("forwards new-session flag to the 3D model step", async () => {
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    act(() => {
      useChatUIStore.getState().setPinnedSourceImage(result.current.streamKey, {
        imageUrl: "https://cdn.example.com/owl.png",
        originalUrl: "https://cdn.example.com/owl-orig.png",
        prompt: "an owl",
      });
    });
    act(() => {
      result.current.markNextSendAsNewSession();
    });

    await act(async () => {
      await result.current.sendMessage(
        "make it brass",
        null,
        "tripo-v2",
        undefined,
        ["generate_3d"],
        "p-1",
        "3d",
        "https://cdn.example.com/owl.png",
      );
    });

    expect(generate3dStream).toHaveBeenCalledWith(
      { kind: "url", imageUrl: "https://cdn.example.com/owl.png" },
      "make it brass",
      expect.any(Object),
      expect.any(AbortSignal),
      "p-1",
      undefined,
      "agent-1",
      undefined,
      true,
      null,
    );
  });

  it("forwards new-session flag to video generation", async () => {
    const { result } = renderHook(() =>
      useAgentChatStream({ agentId: "agent-1" }),
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    await act(async () => {
      await result.current.sendMessage(
        "a bird flying",
        null,
        "veo-3",
        undefined,
        ["generate_video"],
        "p-1",
        "video",
      );
    });

    expect(generateVideoStream).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "a bird flying",
        model: "veo-3",
        projectId: "p-1",
        agentId: "agent-1",
        newSession: true,
        sessionId: null,
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  // Regression for the "+ then click an old session then send" bug.
  // `useStandaloneAgentChat`'s `handleNewChat` arms the pin and drops
  // `?session=`. If the user then clicks an existing session row,
  // the URL re-acquires `?session=` and the hook re-renders with
  // `sessionId="s-old"`. The next send must extend that session or
  // the harness mints a brand-new session id and the URL flips away
  // from the clicked row.
  it("drops the new-session pin when sessionId becomes non-null before sending", async () => {
    const { result, rerender } = renderHook(
      (props: { sessionId: string | null }) =>
        useAgentChatStream({
          agentId: "agent-1",
          sessionId: props.sessionId,
        }),
      { initialProps: { sessionId: null } },
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    rerender({ sessionId: "s-old" });

    await act(async () => {
      await result.current.sendMessage("continue please");
    });

    expect(api.agents.sendEventStream).toHaveBeenCalledWith(
      "agent-1",
      "continue please",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      undefined,
      false,
      "s-old",
    );
  });

  // Regression for the "+ after sending in a freshly-created chat
  // reverts to the previous chat" bug on the standalone-agent
  // surface. Same shape as the project-chat sibling in
  // `use-chat-stream.test.ts`: `useStandaloneAgentChat.handleNewChat`
  // arms the pin BEFORE dropping `?session=`, so the rerender flips
  // `sessionId` from `"s-old"` to `null` after the pin lands. The
  // pin must survive that flip — it's keyed on the lane's
  // fresh-canvas partition (`agentId:fresh`), not the about-to-be-
  // stale real-session partition — so the post-rerender send POSTs
  // `new_session=true` and the server mints a brand-new session
  // (which is what makes `generate_session_title` fire for the new
  // chat's first user message).
  it("arms the new-session pin on the fresh-canvas partition when called before the URL drops the session", async () => {
    const { result, rerender } = renderHook(
      (props: { sessionId: string | null }) =>
        useAgentChatStream({
          agentId: "agent-1",
          sessionId: props.sessionId,
        }),
      { initialProps: { sessionId: "s-old" as string | null } },
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    rerender({ sessionId: null });

    await act(async () => {
      await result.current.sendMessage("start fresh please");
    });

    expect(api.agents.sendEventStream).toHaveBeenCalledWith(
      "agent-1",
      "start fresh please",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      undefined,
      true,
      null,
    );
  });

  // Cross-agent variant: in the chat-app shell the same hook stays
  // mounted as `?agent=` swaps, so a "+" press armed against agent A
  // must not leak forward into the first send on agent B (which would
  // start an unwanted new session there instead of extending B's own
  // most-recent session).
  it("drops the new-session pin when agentId changes between arm and send", async () => {
    const { result, rerender } = renderHook(
      (props: { agentId: string }) => useAgentChatStream({ agentId: props.agentId }),
      { initialProps: { agentId: "agent-a" } },
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    rerender({ agentId: "agent-b" });

    await act(async () => {
      await result.current.sendMessage("hi B");
    });

    expect(api.agents.sendEventStream).toHaveBeenCalledWith(
      "agent-b",
      "hi B",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      undefined,
      false,
      null,
    );
  });
});
