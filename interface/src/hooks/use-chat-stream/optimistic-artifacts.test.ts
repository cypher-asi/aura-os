import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Spec, Task } from "../../types";
import {
  clearAllPendingArtifacts,
  dropPendingByTitle,
  pushPendingSpec,
  pushPendingTask,
  removePendingArtifact,
} from "./optimistic-artifacts";

function makeSpec(id: string, title: string): Spec {
  return {
    spec_id: id,
    project_id: "p1",
    title,
    order_index: 0,
    markdown_contents: "",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

function makeTask(id: string, title: string): Task {
  return {
    task_id: id,
    project_id: "p1",
    spec_id: "s1",
    title,
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
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

function makeSidekick(initialSpecs: Spec[] = [], initialTasks: Task[] = []) {
  const specs: Spec[] = [...initialSpecs];
  const tasks: Task[] = [...initialTasks];
  const pushSpec = vi.fn((s: Spec) => {
    const idx = specs.findIndex((x) => x.spec_id === s.spec_id);
    if (idx === -1) specs.push(s);
    else specs[idx] = s;
  });
  const pushTask = vi.fn((t: Task) => {
    const idx = tasks.findIndex((x) => x.task_id === t.task_id);
    if (idx === -1) tasks.push(t);
    else tasks[idx] = t;
  });
  const removeSpec = vi.fn((id: string) => {
    const idx = specs.findIndex((x) => x.spec_id === id);
    if (idx !== -1) specs.splice(idx, 1);
  });
  const removeTask = vi.fn((id: string) => {
    const idx = tasks.findIndex((x) => x.task_id === id);
    if (idx !== -1) tasks.splice(idx, 1);
  });
  return {
    get specs() {
      return specs;
    },
    get tasks() {
      return tasks;
    },
    pushSpec,
    pushTask,
    removeSpec,
    removeTask,
  };
}

describe("optimistic-artifacts", () => {
  describe("pushPendingSpec", () => {
    let pendingRef: { current: string[] };
    beforeEach(() => {
      pendingRef = { current: [] };
    });

    it("pushes a placeholder spec keyed by the tool call id", () => {
      const sk = makeSidekick();
      pushPendingSpec(
        { id: "tc1", input: { title: "01: Core Types" } },
        "p1",
        sk as never,
        pendingRef,
      );
      expect(sk.pushSpec).toHaveBeenCalledTimes(1);
      expect(sk.pushSpec.mock.calls[0][0].spec_id).toBe("pending-tc1");
      expect(sk.pushSpec.mock.calls[0][0].title).toBe("01: Core Types");
      expect(pendingRef.current).toEqual(["pending-tc1"]);
    });

    it("uses a 'Generating spec' placeholder when no title is supplied", () => {
      const sk = makeSidekick();
      pushPendingSpec({ id: "tc1" }, "p1", sk as never, pendingRef);
      expect(sk.pushSpec.mock.calls[0][0].title).toContain("Generating spec");
    });

    it("is idempotent on the ref: re-pushing the same tool id doesn't duplicate the ref entry", () => {
      const sk = makeSidekick();
      pushPendingSpec(
        { id: "tc1", input: { title: "01" } },
        "p1",
        sk as never,
        pendingRef,
      );
      pushPendingSpec(
        { id: "tc1", input: { title: "01: Core" } },
        "p1",
        sk as never,
        pendingRef,
      );
      expect(pendingRef.current).toEqual(["pending-tc1"]);
      expect(sk.pushSpec).toHaveBeenCalledTimes(2);
    });

    it("skips the placeholder if a real spec with the same title already exists", () => {
      const sk = makeSidekick([makeSpec("real-1", "01: Core Types")]);
      pushPendingSpec(
        { id: "tc1", input: { title: "01: Core Types" } },
        "p1",
        sk as never,
        pendingRef,
      );
      expect(sk.pushSpec).not.toHaveBeenCalled();
      expect(pendingRef.current).toEqual([]);
    });

    it("still pushes updates when the placeholder is already tracked, even if a real spec now matches", () => {
      const sk = makeSidekick();
      pushPendingSpec(
        { id: "tc1", input: { title: "01: Core Types" } },
        "p1",
        sk as never,
        pendingRef,
      );
      sk.pushSpec(makeSpec("real-1", "01: Core Types"));
      pushPendingSpec(
        { id: "tc1", input: { title: "01: Core Types", markdown_contents: "body" } },
        "p1",
        sk as never,
        pendingRef,
      );
      expect(pendingRef.current).toEqual(["pending-tc1"]);
    });
  });

  describe("pushPendingTask", () => {
    it("skips the placeholder if a real task with the same title already exists", () => {
      const sk = makeSidekick([], [makeTask("real-1", "Implement feature")]);
      const pendingRef = { current: [] as string[] };
      pushPendingTask(
        { id: "tc1", input: { title: "Implement feature" } },
        "p1",
        sk as never,
        pendingRef,
      );
      expect(sk.pushTask).not.toHaveBeenCalled();
      expect(pendingRef.current).toEqual([]);
    });
  });

  describe("removePendingArtifact", () => {
    it("removes the pending id from both the ref and the sidekick", () => {
      const pendingRef = { current: ["pending-tc1", "pending-tc2"] };
      const remove = vi.fn();
      removePendingArtifact("tc1", pendingRef, remove);
      expect(pendingRef.current).toEqual(["pending-tc2"]);
      expect(remove).toHaveBeenCalledWith("pending-tc1");
    });

    it("is a no-op when the id isn't tracked", () => {
      const pendingRef = { current: ["pending-tc1"] };
      const remove = vi.fn();
      removePendingArtifact("tc99", pendingRef, remove);
      expect(pendingRef.current).toEqual(["pending-tc1"]);
      expect(remove).not.toHaveBeenCalled();
    });
  });

  describe("clearAllPendingArtifacts", () => {
    it("calls remove for every tracked id and empties the ref", () => {
      const pendingRef = { current: ["pending-a", "pending-b"] };
      const remove = vi.fn();
      clearAllPendingArtifacts(pendingRef, remove);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledWith("pending-a");
      expect(remove).toHaveBeenCalledWith("pending-b");
      expect(pendingRef.current).toEqual([]);
    });

    it("is a no-op when the ref is empty", () => {
      const pendingRef = { current: [] as string[] };
      const remove = vi.fn();
      clearAllPendingArtifacts(pendingRef, remove);
      expect(remove).not.toHaveBeenCalled();
    });
  });

  describe("dropPendingByTitle", () => {
    it("removes only pending ids whose title matches", () => {
      const pendingRef = { current: ["pending-a", "pending-b", "pending-c"] };
      const titles: Record<string, string> = {
        "pending-a": "Target",
        "pending-b": "Other",
        "pending-c": "Target",
      };
      const remove = vi.fn();
      dropPendingByTitle(pendingRef, "Target", (id) => titles[id], remove);
      expect(remove).toHaveBeenCalledWith("pending-a");
      expect(remove).toHaveBeenCalledWith("pending-c");
      expect(remove).not.toHaveBeenCalledWith("pending-b");
      expect(pendingRef.current).toEqual(["pending-b"]);
    });

    it("is a no-op when the ref is empty", () => {
      const pendingRef = { current: [] as string[] };
      const remove = vi.fn();
      dropPendingByTitle(pendingRef, "Anything", () => undefined, remove);
      expect(remove).not.toHaveBeenCalled();
    });
  });
});
