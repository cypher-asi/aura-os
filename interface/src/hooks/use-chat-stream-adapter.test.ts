import { renderHook } from "@testing-library/react";

const mockProjectStream = {
  streamKey: "project-stream-key",
  sendMessage: vi.fn(),
  stopStreaming: vi.fn(),
  resetEvents: vi.fn(),
};

const mockAgentStream = {
  streamKey: "agent-stream-key",
  sendMessage: vi.fn(),
  stopStreaming: vi.fn(),
  resetEvents: vi.fn(),
};

vi.mock("./use-chat-stream", () => ({
  useChatStream: vi.fn(() => mockProjectStream),
}));

vi.mock("./use-agent-chat-stream", () => ({
  useAgentChatStream: vi.fn(() => mockAgentStream),
}));

import { useChatStreamAdapter } from "./use-chat-stream-adapter";
import { useChatStream } from "./use-chat-stream";
import { useAgentChatStream } from "./use-agent-chat-stream";

describe("useChatStreamAdapter", () => {
  beforeEach(() => {
    vi.mocked(useChatStream).mockReturnValue(mockProjectStream as any);
    vi.mocked(useAgentChatStream).mockReturnValue(mockAgentStream as any);
  });

  it("returns project stream when mode is project", () => {
    const { result } = renderHook(() =>
      useChatStreamAdapter("project", { projectId: "proj-1", agentInstanceId: "inst-1" }),
    );

    expect(result.current).toBe(mockProjectStream);
  });

  it("returns agent stream when mode is agent", () => {
    const { result } = renderHook(() =>
      useChatStreamAdapter("agent", { agentId: "agent-1" }),
    );

    expect(result.current).toBe(mockAgentStream);
  });

  it("passes projectId and agentInstanceId to useChatStream in project mode", () => {
    renderHook(() =>
      useChatStreamAdapter("project", { projectId: "proj-1", agentInstanceId: "inst-1" }),
    );

    expect(useChatStream).toHaveBeenCalledWith({
      projectId: "proj-1",
      agentInstanceId: "inst-1",
    });
  });

  it("passes undefined to useChatStream in agent mode", () => {
    renderHook(() =>
      useChatStreamAdapter("agent", { agentId: "agent-1", projectId: "proj-1" }),
    );

    expect(useChatStream).toHaveBeenCalledWith({
      projectId: undefined,
      agentInstanceId: undefined,
    });
  });

  it("passes agentId to useAgentChatStream in agent mode", () => {
    renderHook(() =>
      useChatStreamAdapter("agent", { agentId: "agent-1" }),
    );

    expect(useAgentChatStream).toHaveBeenCalledWith({
      agentId: "agent-1",
    });
  });

  it("passes undefined agentId to useAgentChatStream in project mode", () => {
    renderHook(() =>
      useChatStreamAdapter("project", { projectId: "proj-1", agentId: "agent-1" }),
    );

    expect(useAgentChatStream).toHaveBeenCalledWith({
      agentId: undefined,
    });
  });

  it("always calls both hooks (Rules of Hooks compliance)", () => {
    renderHook(() =>
      useChatStreamAdapter("project", { projectId: "proj-1" }),
    );

    expect(useChatStream).toHaveBeenCalled();
    expect(useAgentChatStream).toHaveBeenCalled();
  });
});
