import { describe, it, expect, beforeEach, vi } from "vitest";

// The repo's vitest setup passes `--localstorage-file` without a valid path,
// which leaves jsdom's `localStorage` without `setItem` / `removeItem` /
// `clear`. Install a Map-backed stub before loading the module under test,
// matching the pattern in `src/lib/browser-db.test.ts`.
vi.hoisted(() => {
  const storage = new Map<string, string>();
  const stub = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: stub,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: stub,
    });
  }
});

import { useTaskOutputPanelStore, type PanelTaskEntry } from "./task-output-panel-store";
import {
  persistTaskTurns,
  readTaskTurns,
  resetTaskTurnCache,
} from "./task-turn-cache";

const TASKS_STORAGE_KEY = "aura-task-output-panel-tasks";

function makeTask(overrides: Partial<PanelTaskEntry> = {}): PanelTaskEntry {
  return {
    taskId: "t1",
    title: "Test task",
    status: "active",
    projectId: "p1",
    updatedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.removeItem(TASKS_STORAGE_KEY);
  resetTaskTurnCache();
  useTaskOutputPanelStore.setState({
    tasks: [],
  });
  vi.clearAllMocks();
});

describe("task-output-panel-store", () => {
  describe("initial state", () => {
    it("starts with empty tasks", () => {
      expect(useTaskOutputPanelStore.getState().tasks).toEqual([]);
    });
  });

  describe("addTask", () => {
    it("adds a new task", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "My Task");
      const tasks = useTaskOutputPanelStore.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].taskId).toBe("t1");
      expect(tasks[0].title).toBe("My Task");
      expect(tasks[0].status).toBe("active");
      expect(tasks[0].projectId).toBe("p1");
    });

    it("does not duplicate an already-active task", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "My Task");
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "My Task");
      expect(useTaskOutputPanelStore.getState().tasks).toHaveLength(1);
    });

    it("re-adds a completed task as active", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "My Task");
      useTaskOutputPanelStore.getState().completeTask("t1");
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "My Task Again");
      const tasks = useTaskOutputPanelStore.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe("active");
    });

    it("falls back to existing title when none provided", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Original");
      useTaskOutputPanelStore.getState().completeTask("t1");
      useTaskOutputPanelStore.getState().addTask("t1", "p1");
      expect(useTaskOutputPanelStore.getState().tasks[0].title).toBe("Original");
    });

    it("stores agentInstanceId", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task", "ai-1");
      expect(useTaskOutputPanelStore.getState().tasks[0].agentInstanceId).toBe("ai-1");
    });
  });

  describe("completeTask", () => {
    it("marks a task as completed", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().completeTask("t1");
      expect(useTaskOutputPanelStore.getState().tasks[0].status).toBe("completed");
    });
  });

  describe("failTask", () => {
    it("marks a task as failed", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().failTask("t1");
      expect(useTaskOutputPanelStore.getState().tasks[0].status).toBe("failed");
    });

    it("stores a non-empty failure reason on the entry", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore
        .getState()
        .failTask("t1", "Automaton emitted empty-path writes");
      expect(useTaskOutputPanelStore.getState().tasks[0].failureReason).toBe(
        "Automaton emitted empty-path writes",
      );
    });

    it("trims whitespace on the stored failure reason", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().failTask("t1", "  build failed  ");
      expect(useTaskOutputPanelStore.getState().tasks[0].failureReason).toBe(
        "build failed",
      );
    });

    it("does not clobber an existing reason with null / empty", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().failTask("t1", "first reason");
      useTaskOutputPanelStore.getState().failTask("t1", null);
      useTaskOutputPanelStore.getState().failTask("t1", "   ");
      expect(useTaskOutputPanelStore.getState().tasks[0].failureReason).toBe(
        "first reason",
      );
    });

    it("stores a provider failure context on the entry", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().failTask("t1", "stream terminated", {
        providerRequestId: "req_01ABC",
        model: "claude-sonnet-4",
        sseErrorType: "api_error",
        messageId: "msg_01",
      });
      const entry = useTaskOutputPanelStore.getState().tasks[0];
      expect(entry.failureContext?.providerRequestId).toBe("req_01ABC");
      expect(entry.failureContext?.model).toBe("claude-sonnet-4");
      expect(entry.failureContext?.sseErrorType).toBe("api_error");
      expect(entry.failureContext?.messageId).toBe("msg_01");
    });

    it("collapses an all-empty provider context to undefined", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().failTask("t1", "stream terminated", {
        providerRequestId: "   ",
        model: "",
        sseErrorType: undefined,
      });
      expect(
        useTaskOutputPanelStore.getState().tasks[0].failureContext,
      ).toBeUndefined();
    });

    it("does not clobber an existing provider context with undefined", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().failTask("t1", "first reason", {
        providerRequestId: "req_first",
      });
      // Second failure (e.g. a synthesized event) has no context —
      // the earlier live context should win rather than be dropped.
      useTaskOutputPanelStore.getState().failTask("t1", "first reason");
      expect(
        useTaskOutputPanelStore.getState().tasks[0].failureContext
          ?.providerRequestId,
      ).toBe("req_first");
    });
  });

  describe("dismissTask", () => {
    it("removes the task", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().dismissTask("t1");
      expect(useTaskOutputPanelStore.getState().tasks).toHaveLength(0);
    });

    it("invalidates the persisted turn cache", () => {
      persistTaskTurns("t1", [
        { id: "e1", role: "assistant", content: "done" },
      ], "p1");
      expect(readTaskTurns("t1", "p1")).toHaveLength(1);

      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().dismissTask("t1");

      expect(readTaskTurns("t1", "p1")).toEqual([]);
    });
  });

  describe("clearCompleted", () => {
    it("removes only completed and failed tasks", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "A");
      useTaskOutputPanelStore.getState().addTask("t2", "p1", "B");
      useTaskOutputPanelStore.getState().addTask("t3", "p1", "C");
      useTaskOutputPanelStore.getState().completeTask("t1");
      useTaskOutputPanelStore.getState().failTask("t3");
      useTaskOutputPanelStore.getState().clearCompleted();
      const tasks = useTaskOutputPanelStore.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].taskId).toBe("t2");
    });

    it("invalidates persisted turn caches for every removed row", () => {
      persistTaskTurns("t1", [{ id: "e1", role: "assistant", content: "a" }], "p1");
      persistTaskTurns("t2", [{ id: "e2", role: "assistant", content: "b" }], "p1");
      persistTaskTurns("t3", [{ id: "e3", role: "assistant", content: "c" }], "p1");

      useTaskOutputPanelStore.getState().addTask("t1", "p1", "A");
      useTaskOutputPanelStore.getState().addTask("t2", "p1", "B");
      useTaskOutputPanelStore.getState().addTask("t3", "p1", "C");
      useTaskOutputPanelStore.getState().completeTask("t1");
      useTaskOutputPanelStore.getState().failTask("t3");
      useTaskOutputPanelStore.getState().clearCompleted();

      expect(readTaskTurns("t1", "p1")).toEqual([]);
      expect(readTaskTurns("t3", "p1")).toEqual([]);
      expect(readTaskTurns("t2", "p1")).toHaveLength(1);
    });
  });

  describe("markAllCompleted", () => {
    it("marks all active tasks as completed", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "A");
      useTaskOutputPanelStore.getState().addTask("t2", "p1", "B");
      useTaskOutputPanelStore.getState().markAllCompleted();
      const tasks = useTaskOutputPanelStore.getState().tasks;
      expect(tasks.every((t) => t.status === "completed")).toBe(true);
    });
  });

  describe("restoreTasks", () => {
    it("adds new entries without duplicating existing ones", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "A");
      const entries: PanelTaskEntry[] = [
        makeTask({ taskId: "t1" }),
        makeTask({ taskId: "t2", title: "B" }),
      ];
      useTaskOutputPanelStore.getState().restoreTasks(entries);
      expect(useTaskOutputPanelStore.getState().tasks).toHaveLength(2);
    });
  });

  describe("clearCompleted", () => {
    it("removes interrupted entries", () => {
      useTaskOutputPanelStore.setState({
        tasks: [
          makeTask({ taskId: "t1", status: "active" }),
          makeTask({ taskId: "t2", status: "interrupted" }),
          makeTask({ taskId: "t3", status: "completed" }),
        ],
      });
      useTaskOutputPanelStore.getState().clearCompleted();
      const tasks = useTaskOutputPanelStore.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].taskId).toBe("t1");
    });
  });
});

describe("task-output-panel-store rehydration", () => {
  beforeEach(() => {
    localStorage.removeItem(TASKS_STORAGE_KEY);
    vi.resetModules();
  });

  it("preserves persisted statuses verbatim on load", async () => {
    // `useProjectLayoutData` now runs `reconcileStatuses` once the
    // server task list is available — that is the authoritative source
    // of truth for "active" rehydrated rows. The store itself no
    // longer blindly demotes active → interrupted because that produced
    // stale "Interrupted" badges for runs the server still considered
    // in progress (and for runs that completed while the UI was
    // closed).
    const persisted: PanelTaskEntry[] = [
      {
        taskId: "t1",
        title: "Active when closed",
        status: "active",
        projectId: "p1",
        updatedAt: Date.now(),
      },
      {
        taskId: "t2",
        title: "Completed before close",
        status: "completed",
        projectId: "p1",
        updatedAt: Date.now(),
      },
    ];
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(persisted));

    const mod = await import("./task-output-panel-store");
    const tasks = mod.useTaskOutputPanelStore.getState().tasks;
    const byId = Object.fromEntries(tasks.map((t) => [t.taskId, t]));

    expect(byId.t1.status).toBe("active");
    expect(byId.t2.status).toBe("completed");
  });

  it("reconcileStatuses patches the subset of provided entries", async () => {
    const mod = await import("./task-output-panel-store");
    mod.useTaskOutputPanelStore.setState({
      tasks: [
        {
          taskId: "t1",
          title: "Active when closed",
          status: "active",
          projectId: "p1",
          updatedAt: 1,
        },
        {
          taskId: "t2",
          title: "Another",
          status: "active",
          projectId: "p1",
          updatedAt: 1,
        },
      ],
    });

    mod.useTaskOutputPanelStore.getState().reconcileStatuses([
      { taskId: "t1", status: "completed" },
    ]);

    const tasks = mod.useTaskOutputPanelStore.getState().tasks;
    const byId = Object.fromEntries(tasks.map((t) => [t.taskId, t]));
    expect(byId.t1.status).toBe("completed");
    expect(byId.t2.status).toBe("active");
  });

  it("reconcileStatuses copies executionNotes onto failed rows when no live reason exists", async () => {
    const mod = await import("./task-output-panel-store");
    mod.useTaskOutputPanelStore.setState({
      tasks: [
        {
          taskId: "t1",
          title: "Active when closed",
          status: "active",
          projectId: "p1",
          updatedAt: 1,
        },
      ],
    });

    mod.useTaskOutputPanelStore.getState().reconcileStatuses([
      { taskId: "t1", status: "failed", executionNotes: "gate: missing build step" },
    ]);

    const entry = mod.useTaskOutputPanelStore.getState().tasks[0];
    expect(entry.status).toBe("failed");
    expect(entry.failureReason).toBe("gate: missing build step");
  });

  it("reconcileStatuses preserves a live failureReason over executionNotes", async () => {
    const mod = await import("./task-output-panel-store");
    mod.useTaskOutputPanelStore.setState({
      tasks: [
        {
          taskId: "t1",
          title: "Already failed",
          status: "failed",
          projectId: "p1",
          updatedAt: 1,
          failureReason: "live WS reason",
        },
      ],
    });

    mod.useTaskOutputPanelStore.getState().reconcileStatuses([
      { taskId: "t1", status: "failed", executionNotes: "stale DB reason" },
    ]);

    expect(mod.useTaskOutputPanelStore.getState().tasks[0].failureReason).toBe(
      "live WS reason",
    );
  });

  it("reconcileStatuses ignores executionNotes on non-failed statuses", async () => {
    const mod = await import("./task-output-panel-store");
    mod.useTaskOutputPanelStore.setState({
      tasks: [
        {
          taskId: "t1",
          title: "Active when closed",
          status: "active",
          projectId: "p1",
          updatedAt: 1,
        },
      ],
    });

    mod.useTaskOutputPanelStore.getState().reconcileStatuses([
      { taskId: "t1", status: "completed", executionNotes: "note" },
    ]);

    expect(
      mod.useTaskOutputPanelStore.getState().tasks[0].failureReason,
    ).toBeUndefined();
  });
});
