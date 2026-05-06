import { renderHook, act } from "@testing-library/react";
import { useAgentChatStream } from "./use-agent-chat-stream";
import { useStreamStore, streamMetaMap } from "./stream/store";
import { useChatUIStore } from "../stores/chat-ui-store";
import { STYLE_LOCK_SUFFIX } from "../constants/generation";
import { EventType, type AuraEvent } from "../shared/types/aura-events";

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

vi.mock("../api/streams", () => ({
  generateImageStream: vi.fn().mockResolvedValue(undefined),
  generate3dStream: vi.fn().mockResolvedValue(undefined),
}));

import { api } from "../api/client";
import { generate3dStream, generateImageStream } from "../api/streams";

describe("useAgentChatStream", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    useChatUIStore.setState({ streams: {} });
    vi.mocked(api.agents.sendEventStream).mockReset().mockResolvedValue(undefined);
    vi.mocked(generateImageStream).mockReset().mockResolvedValue(undefined);
    vi.mocked(generate3dStream).mockReset().mockResolvedValue(undefined);
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
    );
    const pinned = useChatUIStore
      .getState()
      .getPinnedSourceImage(result.current.streamKey);
    expect(pinned).toBeNull();
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
    const errorMsg = entry.events.find((m) => m.content.includes("Error"));
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
    );
  });
});
