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

import type { DisplaySessionEvent } from "../shared/types/stream";
import {
  persistTaskTurns,
  readTaskTurns,
  invalidateTaskTurns,
  resetTaskTurnCache,
} from "./task-turn-cache";

function makeEvent(id: string, text: string): DisplaySessionEvent {
  return {
    id,
    role: "assistant",
    content: text,
    timeline: [{ kind: "text", id: `${id}:text`, content: text }],
  };
}

beforeEach(() => {
  resetTaskTurnCache();
});

describe("task-turn-cache", () => {
  it("persists and reads structured events for a task", () => {
    const events = [makeEvent("e1", "Hello"), makeEvent("e2", "World")];
    persistTaskTurns("task-1", events, "proj-1");

    const read = readTaskTurns("task-1", "proj-1");
    expect(read).toHaveLength(2);
    expect(read[0].id).toBe("e1");
    expect(read[1].content).toBe("World");
    expect(read[0].timeline?.[0]).toMatchObject({ kind: "text", content: "Hello" });
  });

  it("falls back to taskId-only match when projectId does not match", () => {
    persistTaskTurns("task-1", [makeEvent("e1", "A")], "proj-1");
    const read = readTaskTurns("task-1", "proj-other");
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe("e1");
  });

  it("returns an empty array for unknown tasks", () => {
    expect(readTaskTurns("never-saved")).toEqual([]);
  });

  it("overwrites prior entries for the same task+project", () => {
    persistTaskTurns("task-1", [makeEvent("e1", "old")], "proj-1");
    persistTaskTurns("task-1", [makeEvent("e2", "new")], "proj-1");
    const read = readTaskTurns("task-1", "proj-1");
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe("e2");
  });

  it("invalidateTaskTurns drops every entry for a task", () => {
    persistTaskTurns("task-1", [makeEvent("e1", "a")], "proj-1");
    persistTaskTurns("task-2", [makeEvent("e2", "b")], "proj-2");
    invalidateTaskTurns("task-1");
    expect(readTaskTurns("task-1")).toEqual([]);
    expect(readTaskTurns("task-2", "proj-2")).toHaveLength(1);
  });

  it("strips image content blocks to keep cache entries compact", () => {
    const heavy: DisplaySessionEvent = {
      id: "e1",
      role: "assistant",
      content: "img",
      contentBlocks: [
        { type: "text", text: "keep" },
        { type: "image", media_type: "image/png", data: "BIGBASE64".repeat(10_000) },
      ],
    };
    persistTaskTurns("task-1", [heavy]);
    const read = readTaskTurns("task-1");
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
    persistTaskTurns("task-1", [event]);
    const read = readTaskTurns("task-1");
    const result = read[0].toolCalls?.[0].result ?? "";
    expect(result.length).toBeLessThan(10_000);
    expect(result).toContain("[truncated for cache]");
  });

  it("ignores empty event arrays", () => {
    persistTaskTurns("task-1", []);
    expect(readTaskTurns("task-1")).toEqual([]);
  });
});
