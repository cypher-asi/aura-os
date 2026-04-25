import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

import type { AuraEvent } from "../shared/types/aura-events";
import { EventType } from "../shared/types/aura-events";
import { subscribers } from "./event-store/event-store";
import { useEventStore } from "./event-store/index";
import {
  ensureEntry,
  createSetters,
  useStreamStore,
  streamMetaMap,
} from "../hooks/stream/store";
import {
  bootstrapProcessStreamSubscriptions,
  teardownProcessStreamBootstrap,
  processNodeStreamKey,
} from "./process-stream-bootstrap";
import {
  readProcessNodeTurns,
  resetProcessNodeTurnCache,
} from "./process-node-turn-cache";

function resetStreamStore(): void {
  useStreamStore.setState({ entries: {} });
  streamMetaMap.clear();
}

function seedStreamEntry(
  runId: string,
  nodeId: string,
  eventId: string,
  text: string,
): void {
  const key = processNodeStreamKey(runId, nodeId);
  ensureEntry(key);
  const setters = createSetters(key);
  setters.setEvents([
    {
      id: eventId,
      role: "assistant",
      content: text,
      timeline: [{ kind: "text", id: `${eventId}:text`, content: text }],
    },
  ]);
}

function dispatch(event: AuraEvent): void {
  const s = subscribers.get(event.type);
  if (!s) return;
  // `subscribe()` stores callbacks typed generically, so cast when invoking.
  for (const cb of s) (cb as (e: AuraEvent) => void)(event);
}

beforeEach(() => {
  subscribers.clear();
  resetStreamStore();
  resetProcessNodeTurnCache();
  // Reset the event-store taskOutputs map between tests so nothing
  // leaks across cases.
  useEventStore.setState({ taskOutputs: {} });
  bootstrapProcessStreamSubscriptions();
});

afterEach(() => {
  teardownProcessStreamBootstrap();
  subscribers.clear();
  resetStreamStore();
  resetProcessNodeTurnCache();
});

describe("process-stream-bootstrap", () => {
  it("subscribes to ProcessNodeExecuted, ProcessRunCompleted, ProcessRunFailed", () => {
    expect(subscribers.has(EventType.ProcessNodeExecuted)).toBe(true);
    expect(subscribers.has(EventType.ProcessRunCompleted)).toBe(true);
    expect(subscribers.has(EventType.ProcessRunFailed)).toBe(true);
  });

  it("snapshots the stream entry on ProcessNodeExecuted with a terminal status", () => {
    seedStreamEntry("run-1", "node-1", "e1", "hello");

    dispatch({
      type: EventType.ProcessNodeExecuted,
      content: {
        process_id: "proc-1",
        run_id: "run-1",
        node_id: "node-1",
        node_type: "agent",
        status: "completed",
      },
    } as AuraEvent);

    const cached = readProcessNodeTurns("run-1", "node-1");
    expect(cached).toHaveLength(1);
    expect(cached[0].id).toBe("e1");
    expect(cached[0].content).toBe("hello");
  });

  it("does not snapshot on interim running / pending statuses", () => {
    seedStreamEntry("run-1", "node-1", "e1", "hello");

    dispatch({
      type: EventType.ProcessNodeExecuted,
      content: {
        process_id: "proc-1",
        run_id: "run-1",
        node_id: "node-1",
        node_type: "agent",
        status: "running",
      },
    } as AuraEvent);
    expect(readProcessNodeTurns("run-1", "node-1")).toEqual([]);

    dispatch({
      type: EventType.ProcessNodeExecuted,
      content: {
        process_id: "proc-1",
        run_id: "run-1",
        node_id: "node-1",
        node_type: "agent",
        status: "pending",
      },
    } as AuraEvent);
    expect(readProcessNodeTurns("run-1", "node-1")).toEqual([]);
  });

  it("snapshots every node for the run on ProcessRunCompleted", () => {
    seedStreamEntry("run-1", "node-a", "ea", "a");
    seedStreamEntry("run-1", "node-b", "eb", "b");
    seedStreamEntry("run-2", "node-a", "ec", "c");

    dispatch({
      type: EventType.ProcessRunCompleted,
      content: { process_id: "proc-1", run_id: "run-1" },
    } as AuraEvent);

    expect(readProcessNodeTurns("run-1", "node-a")[0].id).toBe("ea");
    expect(readProcessNodeTurns("run-1", "node-b")[0].id).toBe("eb");
    // run-2's node should not be touched by run-1's completion.
    expect(readProcessNodeTurns("run-2", "node-a")).toEqual([]);
  });

  it("snapshots every node for the run on ProcessRunFailed", () => {
    seedStreamEntry("run-1", "node-a", "ea", "a");

    dispatch({
      type: EventType.ProcessRunFailed,
      content: { process_id: "proc-1", run_id: "run-1", error: "boom" },
    } as AuraEvent);

    expect(readProcessNodeTurns("run-1", "node-a")[0].id).toBe("ea");
  });

  it("ignores events that have no corresponding stream entry", () => {
    dispatch({
      type: EventType.ProcessNodeExecuted,
      content: {
        process_id: "proc-1",
        run_id: "run-never",
        node_id: "node-never",
        node_type: "agent",
        status: "completed",
      },
    } as AuraEvent);

    expect(readProcessNodeTurns("run-never", "node-never")).toEqual([]);
  });

  it("is idempotent under repeated bootstrap calls", () => {
    // Second call must be a no-op; otherwise we would double-subscribe
    // and each event would snapshot twice (harmless here, but the
    // contract matches task-stream-bootstrap).
    bootstrapProcessStreamSubscriptions();
    bootstrapProcessStreamSubscriptions();

    const count = subscribers.get(EventType.ProcessNodeExecuted)?.size ?? 0;
    expect(count).toBe(1);
  });
});
