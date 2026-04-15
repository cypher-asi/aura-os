import { beforeEach, describe, expect, it } from "vitest";
import type { Task } from "../../../types";
import { useKanbanStore } from "./kanban-store";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: "task-1",
    project_id: "project-1",
    spec_id: "spec-1",
    title: "Task",
    description: "",
    status: "backlog",
    order_index: 10,
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
    created_at: "2026-04-15T00:00:00.000Z",
    updated_at: "2026-04-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("kanban-store realtime task updates", () => {
  beforeEach(() => {
    useKanbanStore.setState({ tasksByProject: {}, loading: {} });
  });

  it("creates a project cache when the first task arrives", () => {
    useKanbanStore.getState().addTask("project-1", makeTask());

    expect(useKanbanStore.getState().tasksByProject["project-1"]?.tasks).toEqual([
      expect.objectContaining({ task_id: "task-1" }),
    ]);
  });

  it("replaces optimistic tasks without leaving duplicates", () => {
    useKanbanStore.getState().addTask(
      "project-1",
      makeTask({ task_id: "pending-task-1", title: "Draft task" }),
    );
    useKanbanStore.getState().addTask(
      "project-1",
      makeTask({ task_id: "task-1", title: "Server task" }),
    );

    useKanbanStore.getState().replaceTask(
      "project-1",
      "pending-task-1",
      makeTask({ task_id: "task-1", title: "Server task" }),
    );

    expect(useKanbanStore.getState().tasksByProject["project-1"]?.tasks).toEqual([
      expect.objectContaining({ task_id: "task-1", title: "Server task" }),
    ]);
  });
});
