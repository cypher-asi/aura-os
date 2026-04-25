/**
 * Integration tests for the full chat stream lifecycle with the renamed
 * SessionEvent structure. Verifies that SSE events flow through hooks
 * and stores correctly, and that the renamed API URLs are used.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useChatStream } from "./use-chat-stream";
import { useStreamStore, streamMetaMap } from "./stream/store";
import type { DisplaySessionEvent } from "../shared/types/stream";

const mockSetStreamingAgentInstanceId = vi.fn();
const mockClearGeneratedArtifacts = vi.fn();
const mockSetActiveTab = vi.fn();
const mockPushSpec = vi.fn();
const mockPushTask = vi.fn();
const mockRemoveSpec = vi.fn();
const mockRemoveTask = vi.fn();
const mockNotifyAgentInstanceUpdate = vi.fn();

const mockSidekickState = {
  previewItem: null,
  specs: [],
  tasks: [],
  setStreamingAgentInstanceId: mockSetStreamingAgentInstanceId,
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
    vi.fn(
      (selector?: (state: typeof mockSidekickState) => unknown) =>
        selector ? selector(mockSidekickState) : mockSidekickState,
    ),
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
  },
  isInsufficientCreditsError: vi.fn(() => false),
  dispatchInsufficientCredits: vi.fn(),
}));

import { api } from "../api/client";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function getStreamEntry(key: string) {
  return useStreamStore.getState().entries[key];
}

function simulateSSEStream(
  events: Array<{ type: string; content: unknown }>,
) {
  vi.mocked(api.sendEventStream).mockImplementation(
    async (_pid, _aid, _content, _action, _model, _attachments, handler) => {
      for (const evt of events) {
        handler?.onEvent?.(evt as never);
      }
      handler?.onDone?.();
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Chat Stream Integration (SessionEvent)", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    vi.clearAllMocks();
    vi.mocked(api.sendEventStream).mockReset().mockResolvedValue(undefined);
  });

  it("returns renamed API: streamKey, sendMessage, resetEvents", () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    expect(result.current.streamKey).toBeTruthy();
    expect(typeof result.current.sendMessage).toBe("function");
    expect(typeof result.current.stopStreaming).toBe("function");
    expect(typeof result.current.resetEvents).toBe("function");
  });

  it("calls sendEventStream (not sendMessageStream) with correct args", async () => {
    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("Hello");
    });

    expect(api.sendEventStream).toHaveBeenCalledTimes(1);
    const [pid, aid, content] = vi.mocked(api.sendEventStream).mock.calls[0];
    expect(pid).toBe("p-1");
    expect(aid).toBe("ai-1");
    expect(content).toBe("Hello");
  });

  it("full lifecycle: text_delta → tool → tool_result → assistant_message_end → done", async () => {
    simulateSSEStream([
      {
        type: "text_delta",
        content: { text: "I'll create " },
      },
      {
        type: "text_delta",
        content: { text: "a spec for you." },
      },
      {
        type: "tool_use_start",
        content: { id: "tc-1", name: "create_spec" },
      },
      {
        type: "tool_call",
        content: {
          id: "tc-1",
          name: "create_spec",
          input: { title: "Hello World", markdown_contents: "# HW" },
        },
      },
      {
        type: "tool_result",
        content: {
          id: "tc-1",
          name: "create_spec",
          result: JSON.stringify({
            ok: true,
            spec: { id: "spec-real-1", project_id: "p-1", title: "Hello World", content: "# HW", order: 1 },
          }),
          is_error: false,
        },
      },
      {
        type: "assistant_message_end",
        content: {
          message_id: "m-1",
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
          files_changed: { created: [], modified: [], deleted: [] },
        },
      },
      { type: "done", content: {} },
    ]);

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("Create a hello world spec");
    });

    const entry = getStreamEntry(result.current.streamKey);
    expect(entry).toBeDefined();

    const userEvt = entry.events.find(
      (m: DisplaySessionEvent) => m.role === "user",
    );
    expect(userEvt).toBeDefined();
    expect(userEvt?.content).toBe("Create a hello world spec");

    expect(mockPushSpec).toHaveBeenCalled();
    const specCall = mockPushSpec.mock.calls.find(
      (c: unknown[]) => (c[0] as { spec_id: string }).spec_id === "spec-real-1",
    );
    expect(specCall).toBeDefined();
  });

  it("replaces the assistant boundary placeholder when message_end arrives", async () => {
    simulateSSEStream([
      {
        type: "text_delta",
        content: { text: "Hey there! I'm up and running." },
      },
      {
        type: "assistant_message_end",
        content: {
          message_id: "m-1",
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
      {
        type: "message_end",
        content: {
          event: {
            event_id: "evt-1",
            role: "assistant",
            content: "Hey there! I'm up and running.",
            content_blocks: [],
            thinking: "Thought",
            thinking_duration_ms: 6000,
          },
        },
      },
      { type: "done", content: {} },
    ]);

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("Testing");
    });

    const entry = getStreamEntry(result.current.streamKey);
    expect(entry).toBeDefined();

    const assistantEvents = entry.events.filter(
      (message: DisplaySessionEvent) => message.role === "assistant",
    );
    expect(assistantEvents).toHaveLength(1);
    expect(assistantEvents[0]?.id).toBe("evt-1");
    expect(assistantEvents[0]?.content).toBe("Hey there! I'm up and running.");
  });

  it("promotePendingSpec replaces pending on successful tool_result", async () => {
    simulateSSEStream([
      {
        type: "tool_call",
        content: {
          id: "tc-2",
          name: "create_spec",
          input: { title: "Test Spec" },
        },
      },
      {
        type: "tool_result",
        content: {
          id: "tc-2",
          name: "create_spec",
          result: JSON.stringify({
            ok: true,
            spec: {
              id: "spec-uuid-1",
              project_id: "p-1",
              title: "Test Spec",
              content: "Spec body",
              order: 0,
            },
          }),
          is_error: false,
        },
      },
      { type: "done", content: {} },
    ]);

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("create a spec");
    });

    expect(mockRemoveSpec).toHaveBeenCalledWith("pending-tc-2");

    const realSpecPush = mockPushSpec.mock.calls.find(
      (c: unknown[]) => (c[0] as { spec_id: string }).spec_id === "spec-uuid-1",
    );
    expect(realSpecPush).toBeDefined();
    expect((realSpecPush![0] as { title: string }).title).toBe("Test Spec");
  });

  it("promotePendingTask replaces pending on successful tool_result", async () => {
    simulateSSEStream([
      {
        type: "tool_call",
        content: {
          id: "tc-3",
          name: "create_task",
          input: { spec_id: "s1", title: "Task 1", description: "Do something" },
        },
      },
      {
        type: "tool_result",
        content: {
          id: "tc-3",
          name: "create_task",
          result: JSON.stringify({
            ok: true,
            task: {
              id: "task-uuid-1",
              project_id: "p-1",
              spec_id: "s1",
              title: "Task 1",
              description: "Do something",
              status: "pending",
              dependencies: [],
            },
          }),
          is_error: false,
        },
      },
      { type: "done", content: {} },
    ]);

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("create a task");
    });

    expect(mockRemoveTask).toHaveBeenCalledWith("pending-tc-3");

    const realTaskPush = mockPushTask.mock.calls.find(
      (c: unknown[]) => (c[0] as { task_id: string }).task_id === "task-uuid-1",
    );
    expect(realTaskPush).toBeDefined();
  });

  it("error tool_result removes pending spec without promoting", async () => {
    simulateSSEStream([
      {
        type: "tool_call",
        content: {
          id: "tc-4",
          name: "create_spec",
          input: { title: "Fail Spec" },
        },
      },
      {
        type: "tool_result",
        content: {
          id: "tc-4",
          name: "create_spec",
          result: '{"ok": false, "error": "auth failed"}',
          is_error: true,
        },
      },
      { type: "done", content: {} },
    ]);

    const { result } = renderHook(() =>
      useChatStream({ projectId: "p-1", agentInstanceId: "ai-1" }),
    );

    await act(async () => {
      await result.current.sendMessage("create a spec");
    });

    expect(mockRemoveSpec).toHaveBeenCalledWith("pending-tc-4");

    const promotedSpec = mockPushSpec.mock.calls.find(
      (c: unknown[]) => {
        const arg = c[0] as { spec_id: string };
        return arg.spec_id !== "pending-tc-4";
      },
    );
    expect(promotedSpec).toBeUndefined();
  });

  it("store uses events field (not messages)", () => {
    const entry = {
      isStreaming: false,
      events: [] as DisplaySessionEvent[],
      streamingText: "",
      thinkingText: "",
      thinkingDurationMs: null,
      activeToolCalls: [],
      timeline: [],
      progressText: "",
    };

    useStreamStore.setState({ entries: { "test-key": entry } });

    const state = useStreamStore.getState();
    expect(state.entries["test-key"].events).toBeDefined();
    expect(Array.isArray(state.entries["test-key"].events)).toBe(true);
    expect((state.entries["test-key"] as Record<string, unknown>).messages).toBeUndefined();
  });
});
