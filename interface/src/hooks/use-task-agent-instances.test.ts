import { renderHook, waitFor } from "@testing-library/react";
import { useTaskAgentInstances } from "./use-task-agent-instances";
import type { Task, AgentInstance } from "../types";
import { emptyAgentPermissions } from "../types/permissions-wire";

vi.mock("../api/client", () => ({
  api: {
    getAgentInstance: vi.fn(),
  },
}));

import { api } from "../api/client";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
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
    created_at: "2025-01-01",
    updated_at: "2025-01-01",
    ...overrides,
  };
}

function makeAgentInstance(id: string): AgentInstance {
  return {
    agent_instance_id: id,
    project_id: "p-1",
    agent_id: "agent-1",
    name: "Agent",
    role: "dev",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    status: "idle",
    current_task_id: null,
    current_session_id: null,
    total_input_tokens: 0,
    total_output_tokens: 0,
    permissions: emptyAgentPermissions(),
    intent_classifier: null,
    created_at: "2025-01-01",
    updated_at: "2025-01-01",
  } as AgentInstance;
}

describe("useTaskAgentInstances", () => {
  beforeEach(() => {
    vi.mocked(api.getAgentInstance).mockReset();
  });

  it("returns nulls when no agent instance IDs are set", () => {
    const { result } = renderHook(() =>
      useTaskAgentInstances("p-1", makeTask()),
    );

    expect(result.current.agentInstance).toBeNull();
    expect(result.current.completedByAgent).toBeNull();
  });

  it("fetches assigned agent instance", async () => {
    const instance = makeAgentInstance("ai-1");
    vi.mocked(api.getAgentInstance).mockResolvedValue(instance);

    const task = makeTask({ assigned_agent_instance_id: "ai-1" });
    const { result } = renderHook(() => useTaskAgentInstances("p-1", task));

    await waitFor(() => {
      expect(result.current.agentInstance).toEqual(instance);
    });
  });

  it("fetches completed-by agent instance when IDs differ", async () => {
    const assigned = makeAgentInstance("ai-1");
    const completedBy = makeAgentInstance("ai-2");
    vi.mocked(api.getAgentInstance).mockImplementation(async (_pid, id) => {
      if (id === "ai-1") return assigned;
      if (id === "ai-2") return completedBy;
      throw new Error("unknown id");
    });

    const task = makeTask({
      assigned_agent_instance_id: "ai-1",
      completed_by_agent_instance_id: "ai-2",
    });
    const { result } = renderHook(() => useTaskAgentInstances("p-1", task));

    await waitFor(() => {
      expect(result.current.agentInstance).toEqual(assigned);
      expect(result.current.completedByAgent).toEqual(completedBy);
    });
  });

  it("reuses assigned instance when IDs match", async () => {
    const instance = makeAgentInstance("ai-1");
    vi.mocked(api.getAgentInstance).mockResolvedValue(instance);

    const task = makeTask({
      assigned_agent_instance_id: "ai-1",
      completed_by_agent_instance_id: "ai-1",
    });
    const { result } = renderHook(() => useTaskAgentInstances("p-1", task));

    await waitFor(() => {
      expect(result.current.agentInstance).toEqual(instance);
      expect(result.current.completedByAgent).toEqual(instance);
    });
  });

  it("sets null when projectId is undefined", () => {
    const task = makeTask({ assigned_agent_instance_id: "ai-1" });
    const { result } = renderHook(() =>
      useTaskAgentInstances(undefined, task),
    );

    expect(result.current.agentInstance).toBeNull();
  });

  it("handles API failure gracefully", async () => {
    vi.mocked(api.getAgentInstance).mockRejectedValue(new Error("fail"));

    const task = makeTask({ assigned_agent_instance_id: "ai-1" });
    const { result } = renderHook(() => useTaskAgentInstances("p-1", task));

    await waitFor(() => {
      expect(api.getAgentInstance).toHaveBeenCalled();
    });

    expect(result.current.agentInstance).toBeNull();
  });
});
