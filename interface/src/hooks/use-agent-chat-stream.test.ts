import { renderHook, act } from "@testing-library/react";
import { useAgentChatStream } from "./use-agent-chat-stream";
import { useStreamStore, streamMetaMap } from "./stream/store";
import { EventType } from "../shared/types/aura-events";

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

import { api } from "../api/client";

describe("useAgentChatStream", () => {
  beforeEach(() => {
    streamMetaMap.clear();
    useStreamStore.setState({ entries: {} });
    vi.mocked(api.agents.sendEventStream).mockReset().mockResolvedValue(undefined);
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
