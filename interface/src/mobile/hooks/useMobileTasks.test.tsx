import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventType } from "../../shared/types/aura-events";
import { useMobileTasks } from "./useMobileTasks";

type SubscribeCallback = (event: { content: Record<string, unknown>; project_id?: string }) => void;

const subscribeMap = new Map<string, Set<SubscribeCallback>>();

function subscribe(type: string, cb: SubscribeCallback): () => void {
  if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
  subscribeMap.get(type)!.add(cb);
  return () => subscribeMap.get(type)!.delete(cb);
}

function emit(type: EventType, event: { content: Record<string, unknown>; project_id?: string }) {
  act(() => {
    subscribeMap.get(type)?.forEach((cb) => cb(event));
  });
}

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => ({
    project: { project_id: "proj-1" },
    initialTasks: [],
  }),
}));

vi.mock("../../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: typeof subscribe }) => unknown) =>
    selector({ subscribe }),
}));

vi.mock("../../hooks/use-loop-active", () => ({
  useLoopActive: () => false,
}));

vi.mock("../../api/client", () => ({
  api: {
    listTasks: vi.fn().mockResolvedValue([]),
  },
}));

describe("useMobileTasks", () => {
  beforeEach(() => {
    subscribeMap.clear();
  });

  it("appends tasks immediately on TaskSaved events", async () => {
    const { result, unmount } = renderHook(() => useMobileTasks("proj-1"));

    emit(EventType.TaskSaved, {
      project_id: "proj-1",
      content: {
        task: {
          task_id: "task-1",
          project_id: "proj-1",
          spec_id: "spec-1",
          title: "Created mid-stream",
          description: "",
          status: "backlog",
          order_index: 3,
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
        },
      },
    });

    expect(result.current.tasks).toEqual([
      expect.objectContaining({
        task_id: "task-1",
        title: "Created mid-stream",
      }),
    ]);

    await waitFor(() => expect(result.current.loopActive).toBe(false));
    unmount();
  });
});
