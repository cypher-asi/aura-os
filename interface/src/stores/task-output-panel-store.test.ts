import { describe, it, expect, beforeEach, vi } from "vitest";
import { useTaskOutputPanelStore, type PanelTaskEntry } from "./task-output-panel-store";

const STORAGE_KEY = "aura-task-output-panel";
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
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TASKS_STORAGE_KEY);
  useTaskOutputPanelStore.setState({
    panelHeight: 200,
    collapsed: false,
    activeTab: "run",
    tasks: [],
  });
  vi.clearAllMocks();
});

describe("task-output-panel-store", () => {
  describe("initial state", () => {
    it("has default panel height", () => {
      expect(useTaskOutputPanelStore.getState().panelHeight).toBe(200);
    });

    it("is not collapsed", () => {
      expect(useTaskOutputPanelStore.getState().collapsed).toBe(false);
    });

    it("defaults to run tab", () => {
      expect(useTaskOutputPanelStore.getState().activeTab).toBe("run");
    });

    it("starts with empty tasks", () => {
      expect(useTaskOutputPanelStore.getState().tasks).toEqual([]);
    });
  });

  describe("setActiveTab", () => {
    it("switches tab", () => {
      useTaskOutputPanelStore.getState().setActiveTab("terminal");
      expect(useTaskOutputPanelStore.getState().activeTab).toBe("terminal");
    });
  });

  describe("toggleCollapse", () => {
    it("toggles collapsed state", () => {
      useTaskOutputPanelStore.getState().toggleCollapse();
      expect(useTaskOutputPanelStore.getState().collapsed).toBe(true);
      useTaskOutputPanelStore.getState().toggleCollapse();
      expect(useTaskOutputPanelStore.getState().collapsed).toBe(false);
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
  });

  describe("dismissTask", () => {
    it("removes the task", () => {
      useTaskOutputPanelStore.getState().addTask("t1", "p1", "Task");
      useTaskOutputPanelStore.getState().dismissTask("t1");
      expect(useTaskOutputPanelStore.getState().tasks).toHaveLength(0);
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
});
