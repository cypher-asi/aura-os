import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventType } from "../../shared/types/aura-events";
import type { Task } from "../../shared/types";
import { api } from "../../api/client";
import { useMobileTasks } from "./useMobileTasks";

type SubscribeCallback = (event: { content: Record<string, unknown>; project_id?: string }) => void;
const subscribeMap = new Map<string, Set<SubscribeCallback>>();
const context = vi.hoisted(() => ({ projectId: "proj-1", tasks: [] as Task[] }));
function subscribe(type: string, cb: SubscribeCallback): () => void {
  if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
  subscribeMap.get(type)!.add(cb);
  return () => { subscribeMap.get(type)!.delete(cb); };
}
function emit(type: EventType, content: Record<string, unknown>, projectId = "proj-1") {
  act(() => { subscribeMap.get(type)?.forEach((cb) => cb({ content, project_id: projectId })); });
}
vi.mock("../../stores/project-action-store", () => ({
  // Deliberately allocate a fresh array: this reproduced the original loop.
  useProjectActions: () => ({ project: { project_id: context.projectId }, initialTasks: [...context.tasks] }),
}));
vi.mock("../../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: typeof subscribe }) => unknown) => selector({ subscribe }),
}));
vi.mock("../../hooks/use-loop-active", () => ({ useLoopActive: () => false }));
vi.mock("../../stores/live-task-ids-store", () => ({ useLiveTaskIdsForProject: () => new Set() }));
vi.mock("../../api/client", () => ({ api: { listTasks: vi.fn() } }));
function task(id: string, order = 0, projectId = "proj-1"): Task {
  return { task_id: id, project_id: projectId, spec_id: "spec-1", title: id, status: "ready", order_index: order } as Task;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  subscribeMap.clear();
  context.projectId = "proj-1";
  context.tasks = [];
  vi.mocked(api.listTasks).mockReset().mockResolvedValue([]);
});
describe("useMobileTasks", () => {
  it("handles unstable initial arrays and updates them while loading", async () => {
    const pending = deferred<Task[]>();
    vi.mocked(api.listTasks).mockReturnValue(pending.promise);
    context.tasks = [task("last", 2), task("first", 1)];
    const { result, rerender } = renderHook(() => useMobileTasks("proj-1"));
    expect(result.current.tasks.map((t) => t.task_id)).toEqual(["first", "last"]);
    context.tasks = [task("new")];
    rerender();
    expect(result.current.tasks.map((t) => t.task_id)).toEqual(["new"]);
    await act(async () => pending.resolve([task("fetched")]));
    expect(result.current.tasks[0].task_id).toBe("fetched");
  });
  it("preserves saved tasks and status events received before the initial fetch resolves", async () => {
    const pending = deferred<Task[]>();
    vi.mocked(api.listTasks).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useMobileTasks("proj-1"));
    emit(EventType.TaskSaved, { task: task("new", 1) });
    emit(EventType.TaskCompleted, { task_id: "old" });
    await act(async () => pending.resolve([task("old")]));
    expect(result.current.tasks.map((t) => [t.task_id, t.status])).toEqual([["old", "done"], ["new", "ready"]]);
    expect(result.current.tasksBySpec.get("spec-1")).toHaveLength(2);
  });
  it("does not refetch equivalent arrays but accepts a later context refresh", async () => {
    vi.mocked(api.listTasks).mockResolvedValueOnce([task("fetched")]);
    const { result, rerender } = renderHook(() => useMobileTasks("proj-1"));
    await waitFor(() => expect(result.current.tasks[0]?.task_id).toBe("fetched"));
    rerender();
    expect(api.listTasks).toHaveBeenCalledTimes(1);
    const refresh = deferred<Task[]>();
    vi.mocked(api.listTasks).mockReturnValue(refresh.promise);
    context.tasks = [task("refreshed")];
    rerender();
    expect(result.current.tasks[0]?.task_id).toBe("refreshed");
    expect(api.listTasks).toHaveBeenCalledTimes(2);
    await act(async () => refresh.resolve([task("confirmed")]));
    expect(result.current.tasks[0]?.task_id).toBe("confirmed");
  });
  it("applies later saved task status and order without duplicates", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([task("one", 0), task("two", 1)]);
    const { result } = renderHook(() => useMobileTasks("proj-1"));
    await waitFor(() => expect(result.current.tasks).toHaveLength(2));
    emit(EventType.TaskCompleted, { task_id: "one" });
    emit(EventType.TaskSaved, { task: { ...task("one", 2), status: "in_progress" } });
    expect(result.current.tasks.map((t) => [t.task_id, t.status])).toEqual([["two", "ready"], ["one", "in_progress"]]);
  });
  it("ignores task events from other projects", async () => {
    vi.mocked(api.listTasks).mockResolvedValue([task("one")]);
    const { result } = renderHook(() => useMobileTasks("proj-1"));
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    for (const type of [EventType.TaskStarted, EventType.TaskCompleted, EventType.TaskFailed]) emit(type, { task_id: "one" }, "proj-2");
    emit(EventType.TaskSaved, { task: task("other") }, "proj-2");
    expect(result.current.tasks).toEqual([task("one")]);
  });
  it("does not show the previous project's tasks or accept its late response", async () => {
    const first = deferred<Task[]>();
    const second = deferred<Task[]>();
    vi.mocked(api.listTasks).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    context.tasks = [task("old")];
    const { result, rerender } = renderHook(({ projectId }) => useMobileTasks(projectId), { initialProps: { projectId: "proj-1" } });
    emit(EventType.TaskSaved, { task: task("old-event") });
    rerender({ projectId: "proj-2" });
    expect(result.current.tasks).toEqual([]);
    await act(async () => first.resolve([task("late-old")]));
    expect(result.current.tasks).toEqual([]);
    await act(async () => second.resolve([task("new", 0, "proj-2")]));
    expect(result.current.tasks.map((t) => t.task_id)).toEqual(["new"]);
  });
  it("retains initial data on fetch failure and unsubscribes on unmount", async () => {
    context.tasks = [task("cached")];
    vi.mocked(api.listTasks).mockRejectedValue(new Error("offline"));
    const { result, unmount } = renderHook(() => useMobileTasks("proj-1"));
    await act(async () => {});
    expect(result.current.tasks).toEqual([task("cached")]);
    unmount();
    expect([...subscribeMap.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });
});
