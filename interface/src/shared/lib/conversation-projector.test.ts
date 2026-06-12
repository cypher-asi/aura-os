import { describe, expect, it } from "vitest";
import type { DisplaySessionEvent } from "../types/stream";
import { projectConversation } from "./conversation-projector";

function makeUser(id: string, content: string): DisplaySessionEvent {
  return { id, clientId: id, role: "user", content };
}

function makeAssistant(id: string, content: string): DisplaySessionEvent {
  return { id, clientId: id, role: "assistant", content };
}

describe("projectConversation", () => {
  it("returns history when the stream is empty", () => {
    const history = [makeUser("u1", "hi"), makeAssistant("a1", "hello")];
    expect(projectConversation(history, [])).toEqual(history);
  });

  it("returns the stream as-is when history is empty", () => {
    const stream = [makeUser("temp-1", "hi"), makeAssistant("stream-1", "...")];
    expect(projectConversation([], stream)).toEqual(stream);
  });

  it("drops stream events whose id matches a history event", () => {
    const history = [makeUser("u1", "hi"), makeAssistant("a1", "hello")];
    const stream = [
      makeUser("u1", "hi"),
      makeAssistant("a1", "hello"),
    ];
    expect(projectConversation(history, stream)).toEqual(history);
  });

  it("drops the optimistic temp- user when persisted history holds the same content", () => {
    const history = [makeUser("evt-user", "first prompt")];
    const stream = [makeUser("temp-1", "first prompt")];
    expect(projectConversation(history, stream)).toEqual(history);
  });

  it("appends live-only stream events after history", () => {
    const history = [makeUser("u1", "hi"), makeAssistant("a1", "hello")];
    const stream = [
      makeUser("u1", "hi"),
      makeUser("temp-2", "follow-up"),
      makeAssistant("stream-2", "..."),
    ];
    const result = projectConversation(history, stream);
    expect(result.map((m) => m.id)).toEqual(["u1", "a1", "temp-2", "stream-2"]);
  });

  it("keeps a repeated optimistic prompt when history's last user does not match", () => {
    const history = [
      makeUser("u-old", "the answer is 42"),
      makeAssistant("a-old", "noted"),
    ];
    const stream = [makeUser("temp-1", "the answer is 42")];
    const result = projectConversation(history, stream);
    expect(result.map((m) => m.id)).toEqual(["u-old", "a-old", "temp-1"]);
  });

  it("preserves the assistant placeholder appended after an optimistic user prompt", () => {
    const history = [
      makeUser("u-old", "earlier"),
      makeAssistant("a-old", "earlier reply"),
    ];
    const stream = [
      makeUser("temp-2", "follow-up"),
      makeAssistant("stream-2", ""),
    ];
    const result = projectConversation(history, stream);
    expect(result.map((m) => m.id)).toEqual([
      "u-old",
      "a-old",
      "temp-2",
      "stream-2",
    ]);
  });

  it("dedups the persisted user message via id even when content differs from stream temp-", () => {
    // Edge: server may normalize content (trim, etc.). Id-based dedup
    // wins when the persisted id is reused (matches `evt-user` in stream).
    const history = [makeUser("evt-user", "trimmed")];
    const stream = [makeUser("evt-user", "trimmed   ")];
    expect(projectConversation(history, stream)).toEqual(history);
  });

  describe("clientId aliases (stable React identity across persist)", () => {
    it("carries the optimistic temp- clientId onto the persisted user row", () => {
      const aliases = new Map<string, string>();
      const history = [makeUser("evt-user", "first prompt")];
      const stream = [makeUser("temp-1", "first prompt")];
      const result = projectConversation(history, stream, aliases);
      expect(result.map((m) => m.id)).toEqual(["evt-user"]);
      expect(result[0].clientId).toBe("temp-1");
    });

    it("carries the stream clientId onto an id-matched history row", () => {
      const aliases = new Map<string, string>();
      const history = [makeUser("u1", "hi"), makeAssistant("evt-a1", "hello")];
      const stream = [
        { ...makeAssistant("evt-a1", "hello"), clientId: "stream-1" },
      ];
      const result = projectConversation(history, stream, aliases);
      expect(result.map((m) => m.clientId)).toEqual(["u1", "stream-1"]);
    });

    it("keeps the aliased clientId after the stream store is cleared", () => {
      const aliases = new Map<string, string>();
      const history = [makeUser("evt-user", "first prompt")];
      projectConversation(history, [makeUser("temp-1", "first prompt")], aliases);
      // Caught-up clear path: stream events drop, history is authoritative.
      const result = projectConversation(history, [], aliases);
      expect(result[0].clientId).toBe("temp-1");
    });

    it("does not rewrite history rows when no alias was recorded", () => {
      const aliases = new Map<string, string>();
      const history = [makeUser("u1", "hi"), makeAssistant("a1", "hello")];
      const result = projectConversation(history, [], aliases);
      expect(result).toEqual(history);
    });

    it("a fresh registry leaves the persisted clientId untouched", () => {
      const history = [makeUser("evt-user", "first prompt")];
      projectConversation(history, [makeUser("temp-1", "first prompt")], new Map());
      const result = projectConversation(history, [], new Map());
      expect(result[0].clientId).toBe("evt-user");
    });
  });
});
