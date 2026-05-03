import { act, renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  agents: {
    delete: vi.fn<(id: string) => Promise<void>>(async () => undefined),
    listProjectBindings: vi.fn<
      (id: string) => Promise<Array<{
        project_agent_id: string;
        project_id: string;
        project_name: string;
      }>>
    >(async () => []),
    removeProjectBinding: vi.fn<(id: string, bindingId: string) => Promise<void>>(
      async () => undefined,
    ),
  },
  agentStore: {
    fetchAgents: vi.fn(async () => undefined),
    removeAgent: vi.fn<(id: string) => void>(() => undefined),
  },
  projectsStore: {
    refreshProjectAgents: vi.fn<(projectId: string) => Promise<unknown[]>>(
      async () => [],
    ),
  },
}));

vi.mock("../../../api/client", () => ({
  api: { agents: mocks.agents },
}));

vi.mock("../stores", () => ({
  useAgentStore: { getState: () => mocks.agentStore },
}));

vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: { getState: () => mocks.projectsStore },
}));

vi.mock("../../../shared/utils/api-errors", () => ({
  getApiErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  getApiErrorDetails: () => null,
}));

import { useCascadeDeleteAgent } from "./use-cascade-delete-agent";

const agent = {
  agent_id: "agent-1",
  user_id: "user-1",
  name: "Omni",
} as Parameters<typeof useCascadeDeleteAgent>[0];

beforeEach(() => {
  for (const fn of [
    mocks.agents.delete,
    mocks.agents.listProjectBindings,
    mocks.agents.removeProjectBinding,
    mocks.agentStore.fetchAgents,
    mocks.agentStore.removeAgent,
    mocks.projectsStore.refreshProjectAgents,
  ]) {
    fn.mockClear();
  }
});

describe("useCascadeDeleteAgent", () => {
  it("loads project bindings on mount and exposes them", async () => {
    mocks.agents.listProjectBindings.mockResolvedValueOnce([
      { project_agent_id: "pa-1", project_id: "p-home", project_name: "Home" },
    ]);

    const { result } = renderHook(() => useCascadeDeleteAgent(agent));

    await waitFor(() => {
      expect(result.current.bindingsLoading).toBe(false);
    });
    expect(result.current.bindings).toEqual([
      { project_agent_id: "pa-1", project_id: "p-home", project_name: "Home" },
    ]);
    expect(mocks.agents.listProjectBindings).toHaveBeenCalledWith("agent-1");
  });

  it("removes every binding before deleting the template, then refreshes affected projects", async () => {
    mocks.agents.listProjectBindings.mockResolvedValueOnce([
      { project_agent_id: "pa-home", project_id: "p-home", project_name: "Home" },
      { project_agent_id: "pa-other", project_id: "p-other", project_name: "Other" },
    ]);

    const { result } = renderHook(() => useCascadeDeleteAgent(agent));
    await waitFor(() => expect(result.current.bindingsLoading).toBe(false));

    await act(async () => {
      await result.current.deleteWithCascade();
    });

    expect(mocks.agents.removeProjectBinding).toHaveBeenCalledTimes(2);
    expect(mocks.agents.removeProjectBinding).toHaveBeenNthCalledWith(1, "agent-1", "pa-home");
    expect(mocks.agents.removeProjectBinding).toHaveBeenNthCalledWith(2, "agent-1", "pa-other");
    expect(mocks.agents.delete).toHaveBeenCalledWith("agent-1");
    // Both projects whose bindings we removed get a refresh so the
    // project sidebar drops the row immediately.
    expect(mocks.projectsStore.refreshProjectAgents).toHaveBeenCalledWith("p-home");
    expect(mocks.projectsStore.refreshProjectAgents).toHaveBeenCalledWith("p-other");
    expect(mocks.agentStore.removeAgent).toHaveBeenCalledWith("agent-1");
    expect(mocks.agentStore.fetchAgents).toHaveBeenCalledWith({ force: true });
  });

  it("stops the cascade when a binding removal fails and leaves the template alive", async () => {
    mocks.agents.listProjectBindings.mockResolvedValue([
      { project_agent_id: "pa-home", project_id: "p-home", project_name: "Home" },
      { project_agent_id: "pa-other", project_id: "p-other", project_name: "Other" },
    ]);
    mocks.agents.removeProjectBinding.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() => useCascadeDeleteAgent(agent));
    await waitFor(() => expect(result.current.bindingsLoading).toBe(false));

    await act(async () => {
      await expect(result.current.deleteWithCascade()).rejects.toThrow(
        /Could not remove agent from "Home"/,
      );
    });

    expect(mocks.agents.removeProjectBinding).toHaveBeenCalledTimes(1);
    expect(mocks.agents.delete).not.toHaveBeenCalled();
    expect(mocks.agentStore.removeAgent).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/Could not remove agent from "Home"/);
  });

  it("surfaces the server's 409 message verbatim if the template delete fails after all bindings were cleared", async () => {
    mocks.agents.listProjectBindings.mockResolvedValueOnce([]);
    mocks.agents.delete.mockRejectedValueOnce(new Error("Conflict: still in use"));

    const { result } = renderHook(() => useCascadeDeleteAgent(agent));
    await waitFor(() => expect(result.current.bindingsLoading).toBe(false));

    await act(async () => {
      await expect(result.current.deleteWithCascade()).rejects.toThrow();
    });
    expect(result.current.error).toBe("Conflict: still in use");
  });
});
