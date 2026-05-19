import { renderHook, act } from "@testing-library/react";
import { useChatStream } from "./use-chat-stream";
import { useStreamStore, streamMetaMap } from "./stream/store";
import { useChatUIStore } from "../stores/chat-ui-store";
import { useSessionsListStore } from "../stores/sessions-list-store";
import { STYLE_LOCK_SUFFIX } from "../constants/generation";
import { EventType, type AuraEvent } from "../shared/types/aura-events";

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
  // Default to "terminal" — the projects-app initial tab — so existing
  // tests exercise the auto-switch branch in `generate_specs`. Tests
  // that need to verify the Sessions-tab-respecting branch flip this
  // to "sessions" before calling `sendMessage`.
  activeTab: "terminal" as string,
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
vi.mock("../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("../stores/project-action-store", () => ({
  useProjectActions: () => ({
    setProject: vi.fn(),
  }),
}));

vi.mock("../api/client", () => ({
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

describe("useChatStream", () => {
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
    vi.clearAllMocks();
    vi.mocked(api.sendEventStream).mockReset().mockResolvedValue(undefined);
    vi.mocked(generateImageStream).mockReset().mockResolvedValue(undefined);
    vi.mocked(generate3dStream).mockReset().mockResolvedValue(undefined);
    vi.mocked(generateVideoStream).mockReset().mockResolvedValue(undefined);
    mockSidekickState.activeTab = "terminal";
  });

  it("returns streamKey, sendMessage, stopStreaming, resetEvents", () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    expect(result.current.streamKey).toBeTruthy();
    expect(typeof result.current.sendMessage).toBe("function");
    expect(typeof result.current.stopStreaming).toBe("function");
    expect(typeof result.current.resetEvents).toBe("function");
  });

  // Phase 7 Stop / refresh cleanup: pressing Stop must POST
  // `cancel-turn` to the project / instance route so the server
  // forwards `HarnessInbound::Cancel`, releases the per-partition
  // turn slot, and evicts the warm chat session. Without this the
  // turn slot stays held until the 90s SSE idle timeout and the
  // user's next send appears to "time out" with no error surfaced —
  // the bug this regression guard pins.
  it("stopStreaming POSTs cancel-turn for the instance partition", () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    act(() => {
      result.current.stopStreaming();
    });

    expect(api.cancelInstanceTurn).toHaveBeenCalledWith("p-1", "ai-1");
    expect(api.cancelInstanceTurn).toHaveBeenCalledTimes(1);
  });

  // Companion to the test above: the cancel POST is fire-and-forget,
  // so a failed network call (offline, server 500, etc.) MUST NOT
  // throw out of `stopStreaming` — the abort + UI cleanup still
  // need to run, and the server-side SSE drop guard is the safety
  // net for the slot release.
  it("stopStreaming swallows cancel-turn failures", () => {
    vi.mocked(api.cancelInstanceTurn).mockRejectedValueOnce(
      new Error("offline"),
    );

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    expect(() => {
      act(() => {
        result.current.stopStreaming();
      });
    }).not.toThrow();
  });

  it("does nothing when projectId is undefined", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: undefined, agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
  });

  it("does nothing when agentInstanceId is undefined", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: undefined }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
  });

  it("sends a message and creates a user message", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(api.sendEventStream).toHaveBeenCalled();
    const entry = useStreamStore.getState().entries[result.current.streamKey];
    expect(entry.events[0].role).toBe("user");
    expect(entry.events[0].content).toBe("hello");
  });

  it("bumps the sessions list when SessionReady includes the real id", async () => {
    vi.mocked(api.sendEventStream).mockImplementation(
      async (_projectId, _agentInstanceId, _content, _action, _model, _attachments, handler) => {
        handler?.onEvent({
          type: EventType.SessionReady,
          content: { session_id: "s-new" },
        } as AuraEvent);
      },
    );

    const { result } = renderHook(() =>
      useChatStream({
        projectId: "p-1",
        agentInstanceId: "ai-1",
      }),
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });
    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const state = useSessionsListStore.getState();
    expect(state.version).toBe(1);
    expect(state.sessionsBySurface).toEqual({});
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
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "draw a fox",
        null,
        "gpt-image-2",
        attachments,
        ["generate_image"],
        undefined,
        "image",
      );
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
    expect(
      useStreamStore.getState().entries[result.current.streamKey]?.progressText,
    ).toBe("Generating image...");
    expect(generateImageStream).toHaveBeenCalledWith(
      "draw a fox",
      "gpt-image-2",
      attachments,
      expect.any(Object),
      expect.any(AbortSignal),
      // Project chat must forward both ids so the server resolves the
      // project chat session and persists the image-mode turn into
      // history (otherwise it's only in the in-memory stream store and
      // disappears on reload).
      { projectId: "p-1", agentInstanceId: "ai-1" },
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
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "draw a cat",
        null,
        "gpt-image-2",
        undefined,
        ["generate_image"],
        undefined,
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
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "an eagle",
        null,
        "tripo-v2",
        undefined,
        ["generate_3d"],
        undefined,
        "3d",
        undefined,
      );
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
    expect(generate3dStream).not.toHaveBeenCalled();
    expect(generateImageStream).toHaveBeenCalledWith(
      `an eagle${STYLE_LOCK_SUFFIX}`,
      // The image step pins to the default image model regardless of
      // the chat-3D model selection, so the aura router accepts the
      // request.
      expect.any(String),
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      { projectId: "p-1", agentInstanceId: "ai-1" },
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
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    // Seed the pin to simulate a prior image step having completed.
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
        undefined,
        "3d",
        "https://cdn.example.com/owl.png",
      );
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
    expect(generateImageStream).not.toHaveBeenCalled();
    expect(generate3dStream).toHaveBeenCalledWith(
      { kind: "url", imageUrl: "https://cdn.example.com/owl.png" },
      "make it brass",
      expect.any(Object),
      expect.any(AbortSignal),
      "p-1",
      undefined,
      undefined,
      "ai-1",
      false,
      null,
    );
    const pinned = useChatUIStore
      .getState()
      .getPinnedSourceImage(result.current.streamKey);
    expect(pinned).toBeNull();
  });

  it("3D model step: image-only send (no text) still dispatches through generate3dStream", async () => {
    // Regression: the input bar enables Send when only a source image
    // is pinned (no text), but `sendMessage` used to share the
    // empty-content guard with chat mode and would silently no-op the
    // call. The 3D model step bypasses the guard whenever
    // `_generationMode === "3d"` and `_sourceImageUrl` is set.
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage(
        "",
        null,
        "tripo-v2",
        undefined,
        ["generate_3d"],
        undefined,
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
      undefined,
      "ai-1",
      false,
      null,
    );
    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const userMsg = entry.events.find((evt) => evt.role === "user");
    expect(userMsg?.content).toBe("Generate 3D model");
  });

  it("does nothing for empty content without action", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("   ");
    });

    expect(api.sendEventStream).not.toHaveBeenCalled();
  });

  it("sets streaming agent instance ID during send", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockSetAgentStreaming).toHaveBeenCalledWith("ai-1", true);
  });

  it("handles generate_specs action: clears artifacts and auto-switches to Specs from a non-Sessions tab", async () => {
    mockSidekickState.activeTab = "terminal";
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("", "generate_specs");
    });

    expect(mockClearGeneratedArtifacts).toHaveBeenCalled();
    expect(mockSetActiveTab).toHaveBeenCalledWith("specs");
  });

  // Regression for "Plan mode in Projects app flips the sidekick off
  // Sessions on every send". Picking the Sessions tab is an explicit
  // "I want to follow the chat" signal — the auto-switch to Specs
  // must respect that. The matching branch in `useChatStream`
  // (`activeTab !== "sessions"`) guards this; if it ever regresses,
  // this assertion fires.
  it("generate_specs action does NOT switch tabs when the user is already on Sessions", async () => {
    mockSidekickState.activeTab = "sessions";
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("", "generate_specs");
    });

    // Stale artifacts are still cleared so the next plan-mode pass
    // doesn't mix new specs with leftovers from the previous turn —
    // but the tab itself stays put.
    expect(mockClearGeneratedArtifacts).toHaveBeenCalled();
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  it("handles stream errors gracefully", async () => {
    vi.mocked(api.sendEventStream).mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const entry = useStreamStore.getState().entries[result.current.streamKey];
    // Error string is now routed through the dedicated
    // `errorMessage` field (rendered inline in the action row by
    // `MessageBubble`) instead of being concatenated into
    // `content`.
    const errorMsg = entry.events.find((m) =>
      (m.errorMessage ?? "").toLowerCase().includes("fail"),
    );
    expect(errorMsg).toBeTruthy();
  });

  it("ignores AbortError", async () => {
    vi.mocked(api.sendEventStream).mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    const entry = useStreamStore.getState().entries[result.current.streamKey];
    const errorMsgs = entry.events.filter((m) => m.content.includes("Error"));
    expect(errorMsgs).toHaveLength(0);
  });

  it("clears streaming agent ID after completion", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockSetAgentStreaming).toHaveBeenCalledWith("ai-1", false);
  });

  it("marks only the next project send as a new session", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    await act(async () => {
      await result.current.sendMessage("first");
      await result.current.sendMessage("second");
    });

    expect(api.sendEventStream).toHaveBeenNthCalledWith(
      1,
      "p-1",
      "ai-1",
      "first",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      true,
      // `sessionId` is forwarded as-is on every send; `null` here
      // means "no pin requested". The send only forwards a pinned
      // id when the panel passes one in the hook options, which
      // this test doesn't set.
      null,
      // Phase 5 wiring: `clientRetryAttempt` is `undefined` on a
      // first send (the chat hook only sets it when it auto-retries
      // a `streamDropped` close), so the 12th positional argument
      // must remain `undefined` end-to-end here.
      undefined,
    );
    expect(api.sendEventStream).toHaveBeenNthCalledWith(
      2,
      "p-1",
      "ai-1",
      "second",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      false,
      null,
      undefined,
    );
  });

  // Regression: the chat-input "+" affordance must work in EVERY
  // mode, not just code/plan. Previously `markNextSendAsNewSession`
  // only forwarded `new_session: true` on the regular chat
  // (`api.sendEventStream`) path, so image / 3D / video sends
  // silently appended to the latest existing session — the user-
  // facing symptom that motivates this fix.
  it("forwards new-session flag to image generation when armed via markNextSendAsNewSession", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
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
        undefined,
        "image",
      );
    });

    expect(generateImageStream).toHaveBeenCalledWith(
      "draw a fox",
      "gpt-image-2",
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      { projectId: "p-1", agentInstanceId: "ai-1" },
      true,
      // `null` because force-new wins over a pin even if `?session=`
      // were set; here no pin is set either way.
      null,
    );
  });

  it("forwards new-session flag to the 3D image step", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
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
        undefined,
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
      { projectId: "p-1", agentInstanceId: "ai-1" },
      true,
      null,
    );
  });

  it("forwards new-session flag to the 3D model step", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
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
        undefined,
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
      undefined,
      "ai-1",
      true,
      null,
    );
  });

  it("forwards new-session flag to video generation", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
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
        undefined,
        "video",
      );
    });

    expect(generateVideoStream).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "a bird flying",
        model: "veo-3",
        projectId: "p-1",
        agentInstanceId: "ai-1",
        newSession: true,
        sessionId: null,
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  // Regression for the "+ then click an old session then send" bug.
  // `useFreshCanvas` arms `nextSendStartsNewSession` and drops
  // `?session=` from the URL. If the user then clicks an existing
  // session row, the URL re-acquires `?session=` and the hook
  // re-renders with `sessionId="s-old"`. The next send must extend
  // that session — not silently force a fresh harness session id —
  // or the turn lands in a brand-new chat and the URL flips away
  // from the clicked row.
  it("drops the new-session pin when sessionId becomes non-null before sending", async () => {
    const { result, rerender } = renderHook(
      (props: { sessionId: string | null }) =>
        useChatStream({
          projectId: "p-1",
          agentInstanceId: "ai-1",
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

    expect(api.sendEventStream).toHaveBeenCalledWith(
      "p-1",
      "ai-1",
      "continue please",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      false,
      "s-old",
      undefined,
    );
  });

  // Regression for the "+ after sending in a freshly-created chat
  // reverts to the previous chat" bug. Repro:
  //   1. Mount on session B (sessionId="s-old").
  //   2. User clicks "+": `useFreshCanvas.newChat()` calls
  //      `markNextSendAsNewSession()` BEFORE dropping `?session=`,
  //      then drops `?session=` (rerender flips sessionId to null).
  //   3. User sends.
  // With the partition-keyed bug, the pin was written to the
  // about-to-be-stale `…:s-old` partition while the send fired on
  // `…:fresh` — so the wire flag was `new_session=false`, the
  // server reused session B (`existing_session_for_agent`), and
  // `SessionReady` snapped the URL back to B. Pin the post-fix
  // behaviour: the pin must land on the fresh-canvas partition so
  // the post-rerender send POSTs `new_session=true`.
  it("arms the new-session pin on the fresh-canvas partition when called before the URL drops the session", async () => {
    const { result, rerender } = renderHook(
      (props: { sessionId: string | null }) =>
        useChatStream({
          projectId: "p-1",
          agentInstanceId: "ai-1",
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

    expect(api.sendEventStream).toHaveBeenCalledWith(
      "p-1",
      "ai-1",
      "start fresh please",
      null,
      undefined,
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      undefined,
      // The pin must survive the `sessionId="s-old"` → `null` rerender
      // because it was armed against the fresh-canvas partition, not
      // the about-to-be-stale real-session partition.
      true,
      null,
      undefined,
    );
  });

  it("drops the pin across generation modes when sessionId becomes non-null", async () => {
    const { result, rerender } = renderHook(
      (props: { sessionId: string | null }) =>
        useChatStream({
          projectId: "p-1",
          agentInstanceId: "ai-1",
          sessionId: props.sessionId,
        }),
      { initialProps: { sessionId: null } },
    );

    act(() => {
      result.current.markNextSendAsNewSession();
    });

    rerender({ sessionId: "s-old" });

    await act(async () => {
      await result.current.sendMessage(
        "draw a fox",
        null,
        "gpt-image-2",
        undefined,
        ["generate_image"],
        undefined,
        "image",
      );
    });

    expect(generateImageStream).toHaveBeenCalledWith(
      "draw a fox",
      "gpt-image-2",
      undefined,
      expect.any(Object),
      expect.any(AbortSignal),
      { projectId: "p-1", agentInstanceId: "ai-1" },
      false,
      "s-old",
    );
  });
});
