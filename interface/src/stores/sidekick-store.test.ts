import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Spec, Task, Session, AgentInstance } from "../shared/types";
import { useSidekickStore } from "./sidekick-store";

function makeSpec(id: string, order: number): Spec {
  return {
    spec_id: id,
    project_id: "p1",
    title: `Spec ${id}`,
    order_index: order,
    markdown_contents: "",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

function makeTask(id: string, order: number): Task {
  return {
    task_id: id,
    project_id: "p1",
    spec_id: "s1",
    title: `Task ${id}`,
    description: "",
    status: "pending",
    order_index: order,
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
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

function makeSession(): Session {
  return {
    session_id: "sess-1",
    agent_instance_id: "ai1",
    project_id: "p1",
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "",
    status: "active",
    started_at: "2025-01-01T00:00:00Z",
    ended_at: null,
  };
}

const initialState = {
  activeTab: "terminal" as const,
  previewItem: null,
  previewHistory: [],
  infoContent: null,
  showInfo: false,
  specs: [],
  tasks: [],
  deletedSpecIds: [],
  streamingAgentInstanceId: null,
  streamingAgentInstanceIds: [],
  canGoBack: false,
};

beforeEach(() => {
  useSidekickStore.setState(initialState);
});

describe("sidekick-store", () => {
  describe("initial state", () => {
    it("defaults activeTab to terminal", () => {
      expect(useSidekickStore.getState().activeTab).toBe("terminal");
    });

    it("has no preview", () => {
      expect(useSidekickStore.getState().previewItem).toBeNull();
    });

    it("has empty specs and tasks", () => {
      expect(useSidekickStore.getState().specs).toEqual([]);
      expect(useSidekickStore.getState().tasks).toEqual([]);
    });
  });

  describe("setActiveTab", () => {
    it("changes the active tab and hides info", () => {
      useSidekickStore.setState({ showInfo: true });
      useSidekickStore.getState().setActiveTab("tasks");
      expect(useSidekickStore.getState().activeTab).toBe("tasks");
      expect(useSidekickStore.getState().showInfo).toBe(false);
    });
  });

  describe("viewSpec / viewTask / viewSession", () => {
    it("viewSpec sets spec preview and clears history", () => {
      const spec = makeSpec("s1", 0);
      useSidekickStore.getState().viewSpec(spec);
      expect(useSidekickStore.getState().previewItem).toEqual({ kind: "spec", spec });
      expect(useSidekickStore.getState().previewHistory).toEqual([]);
      expect(useSidekickStore.getState().canGoBack).toBe(false);
    });

    it("viewTask sets task preview", () => {
      const task = makeTask("t1", 0);
      useSidekickStore.getState().viewTask(task);
      expect(useSidekickStore.getState().previewItem?.kind).toBe("task");
    });

    it("viewSession sets session preview", () => {
      const session = makeSession();
      useSidekickStore.getState().viewSession(session);
      expect(useSidekickStore.getState().previewItem?.kind).toBe("session");
    });
  });

  describe("pushPreview / goBackPreview / closePreview", () => {
    it("pushPreview pushes current to history", () => {
      const spec = makeSpec("s1", 0);
      const task = makeTask("t1", 0);
      useSidekickStore.getState().viewSpec(spec);
      useSidekickStore.getState().pushPreview({ kind: "task", task });

      expect(useSidekickStore.getState().previewItem?.kind).toBe("task");
      expect(useSidekickStore.getState().previewHistory).toHaveLength(1);
      expect(useSidekickStore.getState().canGoBack).toBe(true);
    });

    it("goBackPreview restores previous item", () => {
      const spec = makeSpec("s1", 0);
      const task = makeTask("t1", 0);
      useSidekickStore.getState().viewSpec(spec);
      useSidekickStore.getState().pushPreview({ kind: "task", task });
      useSidekickStore.getState().goBackPreview();

      expect(useSidekickStore.getState().previewItem?.kind).toBe("spec");
      expect(useSidekickStore.getState().canGoBack).toBe(false);
    });

    it("goBackPreview is noop when history is empty", () => {
      useSidekickStore.getState().viewSpec(makeSpec("s1", 0));
      useSidekickStore.getState().goBackPreview();
      expect(useSidekickStore.getState().previewItem?.kind).toBe("spec");
    });

    it("closePreview clears all preview state", () => {
      useSidekickStore.getState().viewSpec(makeSpec("s1", 0));
      useSidekickStore.getState().closePreview();
      expect(useSidekickStore.getState().previewItem).toBeNull();
      expect(useSidekickStore.getState().previewHistory).toEqual([]);
    });
  });

  describe("toggleInfo", () => {
    it("shows info when hidden", () => {
      useSidekickStore.getState().toggleInfo("Title", "Content");
      expect(useSidekickStore.getState().showInfo).toBe(true);
      expect(useSidekickStore.getState().infoContent).toBe("Content");
    });

    it("hides info when shown", () => {
      useSidekickStore.setState({ showInfo: true, infoContent: "Content" });
      useSidekickStore.getState().toggleInfo("Title", "Content");
      expect(useSidekickStore.getState().showInfo).toBe(false);
    });
  });

  describe("pushSpec / removeSpec / clearDeletedSpecs", () => {
    it("adds a new spec sorted by order_index", () => {
      useSidekickStore.getState().pushSpec(makeSpec("s2", 1));
      useSidekickStore.getState().pushSpec(makeSpec("s1", 0));
      const specs = useSidekickStore.getState().specs;
      expect(specs[0].spec_id).toBe("s1");
      expect(specs[1].spec_id).toBe("s2");
    });

    it("updates existing spec with same id", () => {
      useSidekickStore.getState().pushSpec(makeSpec("s1", 0));
      useSidekickStore.getState().pushSpec({ ...makeSpec("s1", 0), title: "Updated" });
      expect(useSidekickStore.getState().specs).toHaveLength(1);
      expect(useSidekickStore.getState().specs[0].title).toBe("Updated");
    });

    it("removeSpec removes and tracks deleted id", () => {
      useSidekickStore.getState().pushSpec(makeSpec("s1", 0));
      useSidekickStore.getState().removeSpec("s1");
      expect(useSidekickStore.getState().specs).toHaveLength(0);
      expect(useSidekickStore.getState().deletedSpecIds).toContain("s1");
    });

    it("clearDeletedSpecs resets tracked ids", () => {
      useSidekickStore.setState({ deletedSpecIds: ["s1"] });
      useSidekickStore.getState().clearDeletedSpecs();
      expect(useSidekickStore.getState().deletedSpecIds).toEqual([]);
    });

    it("pushSpec with a real id evicts pending placeholders sharing its title", () => {
      const pending = { ...makeSpec("pending-tc1", 1), title: "01: Core Types" };
      useSidekickStore.getState().pushSpec(pending);
      const real = { ...makeSpec("real-1", 1), title: "01: Core Types" };
      useSidekickStore.getState().pushSpec(real);

      const { specs } = useSidekickStore.getState();
      expect(specs).toHaveLength(1);
      expect(specs[0].spec_id).toBe("real-1");
    });

    it("pushSpec keeps unrelated pending placeholders", () => {
      const pA = { ...makeSpec("pending-tcA", 1), title: "01: Core Types" };
      const pB = { ...makeSpec("pending-tcB", 2), title: "02: Identity" };
      useSidekickStore.getState().pushSpec(pA);
      useSidekickStore.getState().pushSpec(pB);
      const real = { ...makeSpec("real-1", 1), title: "01: Core Types" };
      useSidekickStore.getState().pushSpec(real);

      const ids = useSidekickStore.getState().specs.map((s) => s.spec_id);
      expect(ids).toEqual(expect.arrayContaining(["real-1", "pending-tcB"]));
      expect(ids).not.toContain("pending-tcA");
      expect(ids).toHaveLength(2);
    });

    it("pushSpec with a pending id does not evict anything", () => {
      const existing = { ...makeSpec("pending-tc1", 1), title: "01: Core Types" };
      useSidekickStore.getState().pushSpec(existing);
      const another = { ...makeSpec("pending-tc2", 1), title: "01: Core Types" };
      useSidekickStore.getState().pushSpec(another);

      expect(useSidekickStore.getState().specs).toHaveLength(2);
    });

    it("pushSpec promotes the preview from pending placeholder to real spec of the same title", () => {
      const pending = { ...makeSpec("pending-tc1", 1), title: "01: Core Types" };
      useSidekickStore.getState().pushSpec(pending);
      useSidekickStore.getState().viewSpec(pending);
      const real = {
        ...makeSpec("real-1", 1),
        title: "01: Core Types",
        markdown_contents: "# Real body",
      };
      useSidekickStore.getState().pushSpec(real);

      const preview = useSidekickStore.getState().previewItem;
      expect(preview?.kind).toBe("spec");
      if (preview?.kind === "spec") {
        expect(preview.spec.spec_id).toBe("real-1");
        expect(preview.spec.markdown_contents).toBe("# Real body");
      }
    });
  });

  describe("pushTask / removeTask / patchTask", () => {
    it("adds a new task sorted by order_index", () => {
      useSidekickStore.getState().pushTask(makeTask("t2", 1));
      useSidekickStore.getState().pushTask(makeTask("t1", 0));
      expect(useSidekickStore.getState().tasks[0].task_id).toBe("t1");
    });

    it("removeTask removes a task", () => {
      useSidekickStore.getState().pushTask(makeTask("t1", 0));
      useSidekickStore.getState().removeTask("t1");
      expect(useSidekickStore.getState().tasks).toHaveLength(0);
    });

    it("removeTask tracks the id in deletedTaskIds", () => {
      useSidekickStore.getState().pushTask(makeTask("t1", 0));
      useSidekickStore.getState().removeTask("t1");
      expect(useSidekickStore.getState().deletedTaskIds).toContain("t1");
    });

    it("clearDeletedTasks empties the list", () => {
      useSidekickStore.getState().pushTask(makeTask("t1", 0));
      useSidekickStore.getState().removeTask("t1");
      useSidekickStore.getState().clearDeletedTasks();
      expect(useSidekickStore.getState().deletedTaskIds).toEqual([]);
    });

    it("pushTask clears the id from deletedTaskIds", () => {
      useSidekickStore.getState().pushTask(makeTask("t1", 0));
      useSidekickStore.getState().removeTask("t1");
      useSidekickStore.getState().pushTask(makeTask("t1", 0));
      expect(useSidekickStore.getState().deletedTaskIds).not.toContain("t1");
      expect(useSidekickStore.getState().tasks).toHaveLength(1);
    });

    it("patchTask updates task fields", () => {
      useSidekickStore.getState().pushTask(makeTask("t1", 0));
      useSidekickStore.getState().patchTask("t1", { status: "completed" });
      expect(useSidekickStore.getState().tasks[0].status).toBe("completed");
    });

    it("patchTask is noop for unknown task", () => {
      useSidekickStore.getState().patchTask("nonexistent", { status: "completed" });
      expect(useSidekickStore.getState().tasks).toHaveLength(0);
    });

    it("pushTask with a real id evicts pending placeholders sharing its title", () => {
      const pending = { ...makeTask("pending-tc1", 1), title: "Implement feature" };
      useSidekickStore.getState().pushTask(pending);
      const real = { ...makeTask("real-1", 1), title: "Implement feature" };
      useSidekickStore.getState().pushTask(real);

      const tasks = useSidekickStore.getState().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].task_id).toBe("real-1");
    });
  });

  describe("clearGeneratedArtifacts", () => {
    it("clears both specs and tasks", () => {
      useSidekickStore.getState().pushSpec(makeSpec("s1", 0));
      useSidekickStore.getState().pushTask(makeTask("t1", 0));
      useSidekickStore.getState().clearGeneratedArtifacts();
      expect(useSidekickStore.getState().specs).toEqual([]);
      expect(useSidekickStore.getState().tasks).toEqual([]);
    });
  });

  describe("streamingAgentInstanceId", () => {
    it("can be set and cleared", () => {
      useSidekickStore.getState().setStreamingAgentInstanceId("ai1");
      expect(useSidekickStore.getState().streamingAgentInstanceId).toBe("ai1");
      useSidekickStore.getState().setStreamingAgentInstanceId(null);
      expect(useSidekickStore.getState().streamingAgentInstanceId).toBeNull();
    });
  });

  describe("setAgentStreaming (multi-id)", () => {
    it("tracks multiple streaming agents independently", () => {
      const store = useSidekickStore.getState();
      store.setAgentStreaming("ai1", true);
      store.setAgentStreaming("ai2", true);
      const ids = useSidekickStore.getState().streamingAgentInstanceIds;
      expect(ids).toContain("ai1");
      expect(ids).toContain("ai2");
      // Backwards-compat single-string field reflects the most recently
      // added id so legacy "is anything streaming?" truthy checks keep
      // working.
      expect(useSidekickStore.getState().streamingAgentInstanceId).toBe("ai2");
    });

    it("removing one agent leaves the other(s) streaming — regression for the cross-project badge bug", () => {
      const store = useSidekickStore.getState();
      store.setAgentStreaming("ai1", true);
      store.setAgentStreaming("ai2", true);
      store.setAgentStreaming("ai1", false);
      const ids = useSidekickStore.getState().streamingAgentInstanceIds;
      expect(ids).toEqual(["ai2"]);
      expect(useSidekickStore.getState().streamingAgentInstanceId).toBe("ai2");
    });

    it("idempotent on duplicate add and missing remove", () => {
      const store = useSidekickStore.getState();
      store.setAgentStreaming("ai1", true);
      store.setAgentStreaming("ai1", true);
      expect(useSidekickStore.getState().streamingAgentInstanceIds).toEqual(["ai1"]);
      store.setAgentStreaming("ai-never-set", false);
      expect(useSidekickStore.getState().streamingAgentInstanceIds).toEqual(["ai1"]);
    });

    it("legacy setStreamingAgentInstanceId(null) clears the entire set", () => {
      const store = useSidekickStore.getState();
      store.setAgentStreaming("ai1", true);
      store.setAgentStreaming("ai2", true);
      store.setStreamingAgentInstanceId(null);
      expect(useSidekickStore.getState().streamingAgentInstanceIds).toEqual([]);
      expect(useSidekickStore.getState().streamingAgentInstanceId).toBeNull();
    });
  });

  describe("notifyAgentInstanceUpdate / onAgentInstanceUpdate", () => {
    it("listeners receive updates", () => {
      const listener = vi.fn();
      const unsub = useSidekickStore.getState().onAgentInstanceUpdate(listener);
      useSidekickStore.getState().notifyAgentInstanceUpdate({ name: "Agent" } as AgentInstance);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ name: "Agent" }));
      unsub();
    });

    it("unsubscribe stops notifications", () => {
      const listener = vi.fn();
      const unsub = useSidekickStore.getState().onAgentInstanceUpdate(listener);
      unsub();
      useSidekickStore.getState().notifyAgentInstanceUpdate({ name: "Agent" } as AgentInstance);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("updatePreviewTask", () => {
    it("patches the current preview if it matches", () => {
      const task = makeTask("t1", 0);
      useSidekickStore.getState().viewTask(task);
      useSidekickStore.getState().updatePreviewTask({ task_id: "t1", status: "completed" });

      const preview = useSidekickStore.getState().previewItem;
      expect(preview?.kind).toBe("task");
      if (preview?.kind === "task") {
        expect(preview.task.status).toBe("completed");
      }
    });

    it("is noop when preview does not match", () => {
      const task = makeTask("t1", 0);
      useSidekickStore.getState().viewTask(task);
      useSidekickStore.getState().updatePreviewTask({ task_id: "t2", status: "completed" });

      const preview = useSidekickStore.getState().previewItem;
      if (preview?.kind === "task") {
        expect(preview.task.status).toBe("pending");
      }
    });
  });

  describe("updatePreviewSpecs", () => {
    it("updates specs in specs_overview preview", () => {
      const specs = [makeSpec("s1", 0)];
      useSidekickStore.setState({ previewItem: { kind: "specs_overview", specs: [] } });
      useSidekickStore.getState().updatePreviewSpecs(specs);

      const preview = useSidekickStore.getState().previewItem;
      if (preview?.kind === "specs_overview") {
        expect(preview.specs).toEqual(specs);
      }
    });

    it("is noop when preview is not specs_overview", () => {
      useSidekickStore.getState().viewSpec(makeSpec("s1", 0));
      useSidekickStore.getState().updatePreviewSpecs([]);
      expect(useSidekickStore.getState().previewItem?.kind).toBe("spec");
    });
  });
});
