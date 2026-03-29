import { renderHook } from "@testing-library/react";
import { useTaskOutputHydration } from "./use-task-output-hydration";
import type { Task } from "../types";

vi.mock("../api/client", () => ({
  api: {
    getTaskOutput: vi.fn().mockResolvedValue({ output: "", build_steps: [], test_steps: [] }),
  },
}));

import { api } from "../api/client";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: "t-1",
    project_id: "p-1",
    spec_id: "s-1",
    title: "Test task",
    description: "",
    status: "in_progress",
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

describe("useTaskOutputHydration", () => {
  beforeEach(() => {
    vi.mocked(api.getTaskOutput).mockReset().mockResolvedValue({ output: "", build_steps: [], test_steps: [] });
  });

  it("does nothing when projectId is undefined", () => {
    const seed = vi.fn();
    renderHook(() =>
      useTaskOutputHydration(undefined, makeTask(), true, false, "", seed),
    );
    expect(seed).not.toHaveBeenCalled();
  });

  it("does nothing when streamBuf already has content", () => {
    const seed = vi.fn();
    renderHook(() =>
      useTaskOutputHydration("p-1", makeTask(), true, false, "existing output", seed),
    );
    expect(seed).not.toHaveBeenCalled();
    expect(api.getTaskOutput).not.toHaveBeenCalled();
  });

  it("hydrates from inline live_output when present", () => {
    const seed = vi.fn();
    const task = makeTask({ live_output: "inline output" });

    renderHook(() =>
      useTaskOutputHydration("p-1", task, true, false, "", seed),
    );

    expect(seed).toHaveBeenCalledWith("t-1", "inline output", undefined, undefined);
    expect(api.getTaskOutput).not.toHaveBeenCalled();
  });

  it("fetches from API when no inline data is available", async () => {
    vi.mocked(api.getTaskOutput).mockResolvedValue({
      output: "fetched output",
      build_steps: [],
      test_steps: [],
    });

    const seed = vi.fn();
    const task = makeTask({ live_output: "" });

    renderHook(() =>
      useTaskOutputHydration("p-1", task, true, false, "", seed),
    );

    await vi.waitFor(() => {
      expect(api.getTaskOutput).toHaveBeenCalledWith("p-1", "t-1");
    });
  });

  it("does not hydrate twice for the same task", () => {
    const seed = vi.fn();
    const task = makeTask({ live_output: "data" });

    const { rerender } = renderHook(
      ({ t }: { t: Task }) =>
        useTaskOutputHydration("p-1", t, true, false, "", seed),
      { initialProps: { t: task } },
    );

    expect(seed).toHaveBeenCalledTimes(1);

    rerender({ t: task });
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it("does not hydrate for non-active, non-terminal tasks with done status", () => {
    const seed = vi.fn();
    const task = makeTask({ status: "done", live_output: "" });

    renderHook(() =>
      useTaskOutputHydration("p-1", task, false, false, "", seed),
    );

    expect(seed).not.toHaveBeenCalled();
    expect(api.getTaskOutput).not.toHaveBeenCalled();
  });
});
