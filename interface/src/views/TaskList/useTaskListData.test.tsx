import { act, renderHook } from "@testing-library/react";
import { EventType } from "../../types/aura-events";
import { useTaskListData } from "./useTaskListData";

type SubscribeCallback = (event: { content: Record<string, unknown>; project_id?: string }) => void;

const subscribeMap = new Map<string, Set<SubscribeCallback>>();
const sidekickState = {
  specs: [],
  tasks: [],
  streamingAgentInstanceId: null as string | null,
  patchTask: vi.fn(),
  updatePreviewTask: vi.fn(),
};

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
    initialSpecs: [],
    initialTasks: [],
  }),
}));

vi.mock("../../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: typeof subscribe; connected: boolean }) => unknown) =>
    selector({ subscribe, connected: false }),
}));

vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    (selector: (s: typeof sidekickState) => unknown) => selector(sidekickState),
    {
      getState: () => sidekickState,
      subscribe: () => () => {},
    },
  ),
}));

vi.mock("../../hooks/use-loop-active", () => ({
  useLoopActive: () => false,
}));

vi.mock("../../api/client", () => ({
  api: {
    listTasks: vi.fn().mockResolvedValue([]),
  },
}));

describe("useTaskListData", () => {
  beforeEach(() => {
    subscribeMap.clear();
    sidekickState.specs = [];
    sidekickState.tasks = [];
    sidekickState.streamingAgentInstanceId = null;
    sidekickState.patchTask.mockClear();
    sidekickState.updatePreviewTask.mockClear();
  });

  it("updates tasks immediately on TaskSaved websocket events", () => {
    const { result } = renderHook(() => useTaskListData());

    emit(EventType.TaskSaved, {
      project_id: "proj-1",
      content: {
        task: {
          task_id: "task-1",
          project_id: "proj-1",
          spec_id: "spec-1",
          title: "New task",
          description: "Created while streaming",
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
        },
      },
    });

    expect(result.current.tasks).toEqual([
      expect.objectContaining({
        task_id: "task-1",
        title: "New task",
      }),
    ]);
  });

  it("updates specs immediately on SpecSaved websocket events", () => {
    const { result } = renderHook(() => useTaskListData());

    emit(EventType.SpecSaved, {
      project_id: "proj-1",
      content: {
        spec: {
          spec_id: "spec-1",
          project_id: "proj-1",
          title: "Realtime spec",
          order_index: 1,
          markdown_contents: "# Spec",
          created_at: "2026-04-15T00:00:00.000Z",
          updated_at: "2026-04-15T00:00:00.000Z",
        },
      },
    });

    expect(result.current.specs).toEqual([
      expect.objectContaining({
        spec_id: "spec-1",
        title: "Realtime spec",
      }),
    ]);
  });

  it("ignores websocket artifact events for other projects", () => {
    const { result } = renderHook(() => useTaskListData());

    emit(EventType.TaskSaved, {
      project_id: "proj-2",
      content: {
        task: {
          task_id: "task-ignored",
          project_id: "proj-2",
          spec_id: "spec-2",
          title: "Ignored task",
          description: "",
          status: "backlog",
          order_index: 1,
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

    emit(EventType.SpecSaved, {
      project_id: "proj-2",
      content: {
        spec: {
          spec_id: "spec-ignored",
          project_id: "proj-2",
          title: "Ignored spec",
          order_index: 1,
          markdown_contents: "",
          created_at: "2026-04-15T00:00:00.000Z",
          updated_at: "2026-04-15T00:00:00.000Z",
        },
      },
    });

    expect(result.current.tasks).toEqual([]);
    expect(result.current.specs).toEqual([]);
  });
});
