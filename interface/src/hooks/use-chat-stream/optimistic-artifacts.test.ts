import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Spec, Task } from "../../shared/types";
import type { DisplaySessionEvent } from "../../shared/types/stream";
import {
  clearAllPendingArtifacts,
  dropPendingByTitle,
  findTrailingInFlightAssistant,
  pushPendingSpec,
  pushPendingTask,
  rebuildPendingArtifactsFromHistory,
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

  describe("findTrailingInFlightAssistant", () => {
    it("returns undefined when the transcript is empty", () => {
      expect(findTrailingInFlightAssistant([])).toBeUndefined();
    });

    it("returns undefined when the trailing message is not in-flight", () => {
      const msgs: DisplaySessionEvent[] = [
        { id: "a", role: "assistant", content: "done", inFlight: false },
      ];
      expect(findTrailingInFlightAssistant(msgs)).toBeUndefined();
    });

    it("returns the trailing assistant message when it is in-flight", () => {
      const msgs: DisplaySessionEvent[] = [
        { id: "u", role: "user", content: "hi" },
        { id: "a", role: "assistant", content: "...", inFlight: true },
      ];
      expect(findTrailingInFlightAssistant(msgs)?.id).toBe("a");
    });

    it("ignores in-flight markers on non-trailing turns", () => {
      const msgs: DisplaySessionEvent[] = [
        { id: "a1", role: "assistant", content: "x", inFlight: true },
        { id: "u", role: "user", content: "hi" },
        { id: "a2", role: "assistant", content: "y", inFlight: false },
      ];
      expect(findTrailingInFlightAssistant(msgs)).toBeUndefined();
    });
  });

  describe("rebuildPendingArtifactsFromHistory", () => {
    it("re-pushes pending spec/task placeholders for unresolved tool calls in the trailing in-flight turn", () => {
      const sk = makeSidekick();
      const refs = {
        pendingSpecIdsRef: { current: [] as string[] },
        pendingTaskIdsRef: { current: [] as string[] },
      };
      const messages: DisplaySessionEvent[] = [
        {
          id: "a1",
          role: "assistant",
          content: "Working…",
          inFlight: true,
          toolCalls: [
            {
              id: "tc-spec",
              name: "create_spec",
              input: { title: "01: Core" },
              pending: true,
            } as never,
            {
              id: "tc-task",
              name: "create_task",
              input: { title: "Implement core" },
              pending: true,
            } as never,
          ],
        },
      ];

      rebuildPendingArtifactsFromHistory(messages, "p1", sk as never, refs);

      expect(sk.pushSpec).toHaveBeenCalledTimes(1);
      expect(sk.pushSpec.mock.calls[0][0].spec_id).toBe("pending-tc-spec");
      expect(refs.pendingSpecIdsRef.current).toEqual(["pending-tc-spec"]);

      expect(sk.pushTask).toHaveBeenCalledTimes(1);
      expect(sk.pushTask.mock.calls[0][0].task_id).toBe("pending-tc-task");
      expect(refs.pendingTaskIdsRef.current).toEqual(["pending-tc-task"]);
    });

    it("skips tool calls that already have a result (the real entry will land via SpecSaved/TaskSaved)", () => {
      const sk = makeSidekick();
      const refs = {
        pendingSpecIdsRef: { current: [] as string[] },
        pendingTaskIdsRef: { current: [] as string[] },
      };
      const messages: DisplaySessionEvent[] = [
        {
          id: "a1",
          role: "assistant",
          content: "Working…",
          inFlight: true,
          toolCalls: [
            {
              id: "tc-spec",
              name: "create_spec",
              input: { title: "01: Core" },
              result: '{"spec":{"spec_id":"real","title":"01: Core"}}',
              pending: false,
            } as never,
          ],
        },
      ];

      rebuildPendingArtifactsFromHistory(messages, "p1", sk as never, refs);

      expect(sk.pushSpec).not.toHaveBeenCalled();
      expect(refs.pendingSpecIdsRef.current).toEqual([]);
    });

    it("is a no-op when there is no trailing in-flight assistant turn", () => {
      const sk = makeSidekick();
      const refs = {
        pendingSpecIdsRef: { current: [] as string[] },
        pendingTaskIdsRef: { current: [] as string[] },
      };
      rebuildPendingArtifactsFromHistory(
        [{ id: "a", role: "assistant", content: "done", inFlight: false }],
        "p1",
        sk as never,
        refs,
      );
      expect(sk.pushSpec).not.toHaveBeenCalled();
      expect(sk.pushTask).not.toHaveBeenCalled();
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
