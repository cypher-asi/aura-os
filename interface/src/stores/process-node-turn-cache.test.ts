import { describe, it, expect, beforeEach, vi } from "vitest";

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

import type { DisplaySessionEvent } from "../types/stream";
import {
  persistProcessNodeTurns,
  readProcessNodeTurns,
  invalidateProcessNodeTurns,
  resetProcessNodeTurnCache,
} from "./process-node-turn-cache";

function makeEvent(id: string, text: string): DisplaySessionEvent {
  return {
    id,
    role: "assistant",
    content: text,
    timeline: [{ kind: "text", id: `${id}:text`, content: text }],
  };
}

beforeEach(() => {
  resetProcessNodeTurnCache();
});

describe("process-node-turn-cache", () => {
  it("persists and reads structured events for a (run, node) pair", () => {
    const events = [makeEvent("e1", "Hello"), makeEvent("e2", "World")];
    persistProcessNodeTurns("run-1", "node-1", events, "proc-1");

    const read = readProcessNodeTurns("run-1", "node-1");
    expect(read).toHaveLength(2);
    expect(read[0].id).toBe("e1");
    expect(read[1].content).toBe("World");
    expect(read[0].timeline?.[0]).toMatchObject({ kind: "text", content: "Hello" });
  });

  it("scopes entries to (runId, nodeId) so siblings do not collide", () => {
    persistProcessNodeTurns("run-1", "node-a", [makeEvent("a", "A")]);
    persistProcessNodeTurns("run-1", "node-b", [makeEvent("b", "B")]);
    persistProcessNodeTurns("run-2", "node-a", [makeEvent("c", "C")]);

    expect(readProcessNodeTurns("run-1", "node-a")[0].id).toBe("a");
    expect(readProcessNodeTurns("run-1", "node-b")[0].id).toBe("b");
    expect(readProcessNodeTurns("run-2", "node-a")[0].id).toBe("c");
  });

  it("returns an empty array for unknown entries", () => {
    expect(readProcessNodeTurns("never", "nope")).toEqual([]);
  });

  it("overwrites prior entries for the same (run, node)", () => {
    persistProcessNodeTurns("run-1", "node-1", [makeEvent("old", "old")]);
    persistProcessNodeTurns("run-1", "node-1", [makeEvent("new", "new")]);
    const read = readProcessNodeTurns("run-1", "node-1");
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe("new");
  });

  it("invalidateProcessNodeTurns drops matching entries", () => {
    persistProcessNodeTurns("run-1", "node-a", [makeEvent("a", "A")]);
    persistProcessNodeTurns("run-1", "node-b", [makeEvent("b", "B")]);
    persistProcessNodeTurns("run-2", "node-a", [makeEvent("c", "C")]);

    invalidateProcessNodeTurns("run-1", "node-a");
    expect(readProcessNodeTurns("run-1", "node-a")).toEqual([]);
    expect(readProcessNodeTurns("run-1", "node-b")).toHaveLength(1);
    expect(readProcessNodeTurns("run-2", "node-a")).toHaveLength(1);

    invalidateProcessNodeTurns("run-1");
    expect(readProcessNodeTurns("run-1", "node-b")).toEqual([]);
    expect(readProcessNodeTurns("run-2", "node-a")).toHaveLength(1);
  });

  it("strips image content blocks to keep entries compact", () => {
    const heavy: DisplaySessionEvent = {
      id: "e1",
      role: "assistant",
      content: "img",
      contentBlocks: [
        { type: "text", text: "keep" },
        { type: "image", media_type: "image/png", data: "BIGBASE64".repeat(10_000) },
      ],
    };
    persistProcessNodeTurns("run-1", "node-1", [heavy]);
    const read = readProcessNodeTurns("run-1", "node-1");
    expect(read[0].contentBlocks).toEqual([{ type: "text", text: "keep" }]);
  });

  it("truncates oversized tool-call results", () => {
    const event: DisplaySessionEvent = {
      id: "e1",
      role: "assistant",
      content: "tool",
      toolCalls: [
        {
          id: "tc1",
          name: "read_file",
          input: {},
          pending: false,
          result: "X".repeat(50_000),
        },
      ],
    };
    persistProcessNodeTurns("run-1", "node-1", [event]);
    const read = readProcessNodeTurns("run-1", "node-1");
    const result = read[0].toolCalls?.[0].result ?? "";
    expect(result.length).toBeLessThan(10_000);
    expect(result).toContain("[truncated for cache]");
  });

  it("ignores empty event arrays", () => {
    persistProcessNodeTurns("run-1", "node-1", []);
    expect(readProcessNodeTurns("run-1", "node-1")).toEqual([]);
  });
});
