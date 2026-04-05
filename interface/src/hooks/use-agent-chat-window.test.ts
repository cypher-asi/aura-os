import { renderHook, act } from "@testing-library/react";

const mockSendMessage = vi.fn();
const mockStopStreaming = vi.fn();
const mockResetEvents = vi.fn();

vi.mock("./use-chat-stream-adapter", () => ({
  useChatStreamAdapter: vi.fn(() => ({
    streamKey: "test-stream-key",
    sendMessage: mockSendMessage,
    stopStreaming: mockStopStreaming,
    resetEvents: mockResetEvents,
  })),
}));

vi.mock("./use-chat-history-sync", () => ({
  useChatHistorySync: vi.fn(() => ({
    historyResolved: true,
    isLoading: false,
    historyError: null,
    wrapSend: (fn: (...args: unknown[]) => unknown) => fn,
  })),
}));

vi.mock("./use-delayed-loading", () => ({
  useDelayedLoading: vi.fn((loading: boolean) => loading),
}));

vi.mock("./use-agent-chat-meta", () => ({
  useAgentChatMeta: vi.fn(() => ({
    agentName: "Test Agent",
    machineType: "local",
    templateAgentId: "template-1",
  })),
}));

vi.mock("../api/client", () => ({
  api: {
    agents: {
      listEvents: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("../stores/chat-history-store", () => ({
  agentHistoryKey: (id: string) => `agent:${id}`,
}));

const mockSetSelectedAgent = vi.fn();
vi.mock("../apps/agents/stores", () => ({
  useAgentStore: (selector: (s: { setSelectedAgent: typeof mockSetSelectedAgent }) => unknown) =>
    selector({ setSelectedAgent: mockSetSelectedAgent }),
}));

let mockProjects: { project_id: string }[] = [];
let mockAgentsByProject: Record<string, { agent_id: string }[]> = {};

vi.mock("../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (s: { projects: typeof mockProjects; agentsByProject: typeof mockAgentsByProject }) => unknown) =>
    selector({ projects: mockProjects, agentsByProject: mockAgentsByProject }),
}));

import { useAgentChatWindow } from "./use-agent-chat-window";

describe("useAgentChatWindow", () => {
  beforeEach(() => {
    mockProjects = [];
    mockAgentsByProject = {};
    mockSendMessage.mockReset();
    mockStopStreaming.mockReset();
    mockResetEvents.mockReset();
    mockSetSelectedAgent.mockReset();
    localStorage.clear();
  });

  it("returns not ready when agentId is undefined", () => {
    const { result } = renderHook(() => useAgentChatWindow(undefined));

    expect(result.current.ready).toBe(false);
    expect(result.current.streamKey).toBe("test-stream-key");
  });

  it("returns ready when agentId is provided", () => {
    const { result } = renderHook(() => useAgentChatWindow("agent-1"));

    expect(result.current.ready).toBe(true);
    expect(result.current.streamKey).toBe("test-stream-key");
  });

  it("provides chat panel props", () => {
    const { result } = renderHook(() => useAgentChatWindow("agent-1"));

    expect(result.current.agentName).toBe("Test Agent");
    expect(result.current.machineType).toBe("local");
    expect(result.current.templateAgentId).toBe("template-1");
    expect(result.current.agentId).toBe("agent-1");
    expect(result.current.emptyMessage).toBe("Send a message");
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.historyResolved).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("exposes onSend and onStop", () => {
    const { result } = renderHook(() => useAgentChatWindow("agent-1"));

    expect(typeof result.current.onSend).toBe("function");
    expect(typeof result.current.onStop).toBe("function");
  });

  it("filters projects for the given agent", () => {
    mockProjects = [
      { project_id: "proj-1" },
      { project_id: "proj-2" },
      { project_id: "proj-3" },
    ];
    mockAgentsByProject = {
      "proj-1": [{ agent_id: "agent-1" }],
      "proj-2": [{ agent_id: "agent-2" }],
      "proj-3": [{ agent_id: "agent-1" }],
    };

    const { result } = renderHook(() => useAgentChatWindow("agent-1"));

    expect(result.current.projects).toHaveLength(2);
    expect(result.current.projects!.map((p) => p.project_id)).toEqual(["proj-1", "proj-3"]);
  });

  it("selects first matching project when no persisted selection", () => {
    mockProjects = [{ project_id: "proj-1" }];
    mockAgentsByProject = { "proj-1": [{ agent_id: "agent-1" }] };

    const { result } = renderHook(() => useAgentChatWindow("agent-1"));

    expect(result.current.selectedProjectId).toBe("proj-1");
  });

  it("persists project selection on change", () => {
    mockProjects = [
      { project_id: "proj-1" },
      { project_id: "proj-2" },
    ];
    mockAgentsByProject = {
      "proj-1": [{ agent_id: "agent-1" }],
      "proj-2": [{ agent_id: "agent-1" }],
    };

    const { result } = renderHook(() => useAgentChatWindow("agent-1"));

    act(() => {
      result.current.onProjectChange!("proj-2");
    });

    expect(result.current.selectedProjectId).toBe("proj-2");
    expect(localStorage.getItem("aura-agent-project:agent-1")).toBe("proj-2");
  });

  it("loads persisted project on mount", () => {
    localStorage.setItem("aura-agent-project:agent-1", "proj-2");

    mockProjects = [
      { project_id: "proj-1" },
      { project_id: "proj-2" },
    ];
    mockAgentsByProject = {
      "proj-1": [{ agent_id: "agent-1" }],
      "proj-2": [{ agent_id: "agent-1" }],
    };

    const { result } = renderHook(() => useAgentChatWindow("agent-1"));

    expect(result.current.selectedProjectId).toBe("proj-2");
  });

  it("falls back to first project when persisted project no longer valid", () => {
    localStorage.setItem("aura-agent-project:agent-1", "proj-gone");

    mockProjects = [{ project_id: "proj-1" }];
    mockAgentsByProject = { "proj-1": [{ agent_id: "agent-1" }] };

    const { result } = renderHook(() => useAgentChatWindow("agent-1"));

    expect(result.current.selectedProjectId).toBe("proj-1");
  });

  it("scrollResetKey matches agentId", () => {
    const { result } = renderHook(() => useAgentChatWindow("agent-42"));

    expect(result.current.scrollResetKey).toBe("agent-42");
  });
});
