import { renderHook } from "@testing-library/react";
import { useAgentChatMeta } from "./use-agent-chat-meta";

const mockUseQuery = vi.fn();

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (...args: unknown[]) => mockUseQuery(...args),
  };
});

vi.mock("../apps/agents/stores", () => ({
  useSelectedAgent: () => ({ selectedAgent: null }),
  useAgentStore: (selector: (state: { agents: unknown[] }) => unknown) => selector({ agents: [] }),
}));

describe("useAgentChatMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: {
        name: "Atlas",
        machine_type: "remote",
        agent_id: "agent-1",
        adapter_type: "aura_harness",
        default_model: "claude-sonnet",
      },
    });
  });

  it("does not keep previous project-agent metadata while switching instances", () => {
    const { result } = renderHook(() => useAgentChatMeta("project", {
      projectId: "project-1",
      agentInstanceId: "agent-inst-1",
    }));

    expect(result.current).toEqual({
      agentName: "Atlas",
      machineType: "remote",
      templateAgentId: "agent-1",
      adapterType: "aura_harness",
      defaultModel: "claude-sonnet",
    });
    expect(mockUseQuery).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
    }));
    expect(mockUseQuery.mock.calls[0]?.[0]).not.toHaveProperty("placeholderData");
  });
});
