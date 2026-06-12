import type { Dispatch, SetStateAction } from "react";
import { applySubagentStatus, registerSpawnedSubagent } from "./subagent-cards";
import type {
  DisplaySessionEvent,
  StreamRefs,
  StreamSetters,
  ToolCallEntry,
} from "../../shared/types/stream";
import type {
  SubagentSpawned,
  SubagentStatus,
} from "../../shared/types/harness-protocol";

function makeRefs(toolCalls: ToolCallEntry[]): StreamRefs {
  return {
    streamBuffer: { current: "" },
    thinkingBuffer: { current: "" },
    thinkingStart: { current: null },
    toolCalls: { current: toolCalls },
    raf: { current: null },
    flushTimeout: { current: null },
    displayedTextLength: { current: 0 },
    lastTextFlushAt: { current: 0 },
    thinkingRaf: { current: null },
    timeline: { current: [] },
    snapshottedToolCallIds: { current: new Set<string>() },
  };
}

interface Harness {
  refs: StreamRefs;
  setters: StreamSetters;
  getEvents: () => DisplaySessionEvent[];
}

function makeHarness(
  toolCalls: ToolCallEntry[],
  initialEvents: DisplaySessionEvent[] = [],
): Harness {
  const refs = makeRefs(toolCalls);
  let events = initialEvents;
  const setEvents: Dispatch<SetStateAction<DisplaySessionEvent[]>> = (update) => {
    events = typeof update === "function" ? update(events) : update;
  };
  const noop = vi.fn();
  const setters: StreamSetters = {
    applyStreamingPatch: noop,
    setStreamingText: noop,
    setThinkingText: noop,
    setThinkingDurationMs: noop,
    setActiveToolCalls: vi.fn(),
    setEvents,
    setIsStreaming: noop,
    setIsWriting: noop,
    setProgressText: noop,
    setTimeline: noop,
    setGenerationState: noop,
    setGenerationPercent: noop,
    clearGeneration: noop,
  };
  return { refs, setters, getEvents: () => events };
}

function taskCall(id: string, overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return { id, name: "Task", input: {}, pending: true, ...overrides };
}

const spawn = (overrides: Partial<SubagentSpawned> = {}): SubagentSpawned => ({
  child_run_id: "child-run-123",
  parent_tool_use_id: "toolu_task_1",
  subagent_type: "explore",
  prompt: "explore the repo",
  ...overrides,
});

describe("registerSpawnedSubagent", () => {
  it("stamps the originating task card with run id, type, prompt, and running status", () => {
    const h = makeHarness([taskCall("toolu_task_1")]);
    registerSpawnedSubagent(h.refs, h.setters, spawn());

    const tc = h.refs.toolCalls.current[0];
    expect(tc.subagentRunId).toBe("child-run-123");
    expect(tc.subagentType).toBe("explore");
    expect(tc.subagentPrompt).toBe("explore the repo");
    expect(tc.subagentStatus).toBe("running");
  });

  it("does nothing when the spawn has no parent tool-use id", () => {
    const h = makeHarness([taskCall("toolu_task_1")]);
    registerSpawnedSubagent(h.refs, h.setters, spawn({ parent_tool_use_id: null }));

    expect(h.refs.toolCalls.current[0].subagentRunId).toBeUndefined();
  });

  it("does not clobber a type/prompt the card already carried", () => {
    const h = makeHarness([
      taskCall("toolu_task_1", {
        subagentType: "shell",
        subagentPrompt: "run the build",
      }),
    ]);
    registerSpawnedSubagent(h.refs, h.setters, spawn());

    const tc = h.refs.toolCalls.current[0];
    expect(tc.subagentType).toBe("shell");
    expect(tc.subagentPrompt).toBe("run the build");
    expect(tc.subagentRunId).toBe("child-run-123");
  });

  it("patches a matching card in an already-finalized events turn", () => {
    const event: DisplaySessionEvent = {
      id: "evt-1",
      role: "assistant",
      content: "",
      toolCalls: [taskCall("toolu_task_1", { pending: false })],
    };
    const h = makeHarness([], [event]);
    registerSpawnedSubagent(h.refs, h.setters, spawn());

    const patched = h.getEvents()[0].toolCalls?.[0];
    expect(patched?.subagentRunId).toBe("child-run-123");
    expect(patched?.subagentStatus).toBe("running");
  });

  it("synthesizes a council parent entry when none exists and folds in the member", () => {
    // Council runs fan members out directly with no preceding `task`
    // tool call, so there is no parent entry to attach to. The first
    // council spawn must create one and the registry then renders the
    // CouncilPanel.
    const h = makeHarness([]);
    registerSpawnedSubagent(
      h.refs,
      h.setters,
      spawn({
        child_run_id: "child-a",
        parent_tool_use_id: "toolu_council_1",
        subagent_type: "council-member",
        model: "openai/gpt",
        council_index: 0,
        council_mechanism: "side_by_side",
      }),
    );

    const entry = h.refs.toolCalls.current.find((tc) => tc.id === "toolu_council_1");
    expect(entry).toBeDefined();
    expect(entry?.councilMembers).toHaveLength(1);
    expect(entry?.councilMembers?.[0].childRunId).toBe("child-a");
    expect(entry?.councilMembers?.[0].councilIndex).toBe(0);
    // The council-wide mechanism is surfaced on the parent entry for the
    // panel label.
    expect(entry?.councilMechanism).toBe("side_by_side");
    expect(
      h.refs.timeline.current.some(
        (item) => item.kind === "tool" && item.toolCallId === "toolu_council_1",
      ),
    ).toBe(true);
  });

  it("folds additional council members onto the same parent entry, ordered by index", () => {
    const h = makeHarness([]);
    // Slot 1 arrives before slot 0 to prove ordering by council_index.
    registerSpawnedSubagent(
      h.refs,
      h.setters,
      spawn({
        child_run_id: "child-b",
        parent_tool_use_id: "toolu_council_1",
        subagent_type: "council-member",
        model: "anthropic/claude",
        council_index: 1,
      }),
    );
    registerSpawnedSubagent(
      h.refs,
      h.setters,
      spawn({
        child_run_id: "child-a",
        parent_tool_use_id: "toolu_council_1",
        subagent_type: "council-member",
        model: "openai/gpt",
        council_index: 0,
      }),
    );

    const entries = h.refs.toolCalls.current.filter(
      (tc) => tc.id === "toolu_council_1",
    );
    expect(entries).toHaveLength(1);
    const members = entries[0].councilMembers ?? [];
    expect(members.map((m) => m.councilIndex)).toEqual([0, 1]);
    expect(members.map((m) => m.childRunId)).toEqual(["child-a", "child-b"]);
  });
});

describe("applySubagentStatus", () => {
  function statusHarness(): Harness {
    const h = makeHarness([taskCall("toolu_task_1")]);
    registerSpawnedSubagent(h.refs, h.setters, spawn());
    return h;
  }

  const status = (overrides: Partial<SubagentStatus> = {}): SubagentStatus => ({
    child_run_id: "child-run-123",
    state: "completed",
    reason: null,
    ...overrides,
  });

  it("transitions running -> completed for the matching child run", () => {
    const h = statusHarness();
    applySubagentStatus(h.refs, h.setters, status({ state: "completed" }));
    expect(h.refs.toolCalls.current[0].subagentStatus).toBe("completed");
  });

  it("records a failure reason on a failed transition", () => {
    const h = statusHarness();
    applySubagentStatus(
      h.refs,
      h.setters,
      status({ state: "failed", reason: "boom" }),
    );
    const tc = h.refs.toolCalls.current[0];
    expect(tc.subagentStatus).toBe("failed");
    expect(tc.subagentReason).toBe("boom");
  });

  it("applies a rejected transition (e.g. depth/quota)", () => {
    const h = statusHarness();
    applySubagentStatus(
      h.refs,
      h.setters,
      status({ state: "rejected", reason: "max depth exceeded" }),
    );
    const tc = h.refs.toolCalls.current[0];
    expect(tc.subagentStatus).toBe("rejected");
    expect(tc.subagentReason).toBe("max depth exceeded");
  });

  it("preserves a previously-set reason when the new status omits one", () => {
    const h = statusHarness();
    applySubagentStatus(
      h.refs,
      h.setters,
      status({ state: "failed", reason: "first" }),
    );
    applySubagentStatus(h.refs, h.setters, status({ state: "failed", reason: null }));
    expect(h.refs.toolCalls.current[0].subagentReason).toBe("first");
  });

  it("ignores a status for an unknown child run id", () => {
    const h = statusHarness();
    applySubagentStatus(
      h.refs,
      h.setters,
      status({ child_run_id: "other-run", state: "failed" }),
    );
    expect(h.refs.toolCalls.current[0].subagentStatus).toBe("running");
  });
});
