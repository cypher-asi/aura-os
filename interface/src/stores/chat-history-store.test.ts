import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionEvent } from "../shared/types";
import type { DisplaySessionEvent } from "../shared/types/stream";
import { queryClient } from "../shared/lib/query-client";

vi.mock("../utils/build-display-messages", () => ({
  buildDisplayEvents: (msgs: SessionEvent[]): DisplaySessionEvent[] =>
    msgs.map((m) => ({ id: m.event_id, role: m.role, text: m.content })) as unknown as DisplaySessionEvent[],
}));

import {
  useChatHistoryStore,
  agentHistoryKey,
  projectChatHistoryKey,
} from "./chat-history-store";

function makeFetchFn(msgs: SessionEvent[] = []): () => Promise<SessionEvent[]> {
  return vi.fn<() => Promise<SessionEvent[]>>().mockResolvedValue(msgs);
}

function makeMsg(id: string): SessionEvent {
  return {
    event_id: id,
    agent_instance_id: "ai1",
    project_id: "p1",
    role: "user",
    content: `msg-${id}`,
    created_at: "2025-06-01T00:00:00Z",
  };
}

beforeEach(() => {
  queryClient.clear();
  useChatHistoryStore.setState({ entries: {}, previewLastMessages: {} });
});

describe("chat-history-store", () => {
  describe("initial state", () => {
    it("has empty entries", () => {
      expect(useChatHistoryStore.getState().entries).toEqual({});
    });
  });

  describe("fetchHistory", () => {
    it("populates an entry on success", async () => {
      const fetchFn = makeFetchFn([makeMsg("m1")]);
      await useChatHistoryStore.getState().fetchHistory("k1", fetchFn);

      const entry = useChatHistoryStore.getState().entries["k1"];
      expect(entry.status).toBe("ready");
      expect(entry.events).toHaveLength(1);
      expect(entry.error).toBeNull();
      expect(useChatHistoryStore.getState().previewLastMessages.k1?.id).toBe("m1");
    });

    it("keeps preview messages when bounded history entries are evicted", async () => {
      for (let i = 0; i < 9; i += 1) {
        await useChatHistoryStore.getState().fetchHistory(`k${i}`, makeFetchFn([makeMsg(`m${i}`)]));
      }

      expect(useChatHistoryStore.getState().entries.k0).toBeUndefined();
      expect(useChatHistoryStore.getState().previewLastMessages.k0?.id).toBe("m0");
    });

    it("sets error status on failure", async () => {
      const fetchFn = vi.fn<() => Promise<SessionEvent[]>>().mockRejectedValue(new Error("boom"));
      await useChatHistoryStore.getState().fetchHistory("k2", fetchFn);

      const entry = useChatHistoryStore.getState().entries["k2"];
      expect(entry.status).toBe("error");
      expect(entry.error).toBe("boom");
    });

    it("skips re-fetch when cache is fresh and not forced", async () => {
      const fetchFn = makeFetchFn([makeMsg("m1")]);
      await useChatHistoryStore.getState().fetchHistory("k3", fetchFn);
      await useChatHistoryStore.getState().fetchHistory("k3", fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("re-fetches when force is true", async () => {
      const fetchFn = makeFetchFn([makeMsg("m1")]);
      await useChatHistoryStore.getState().fetchHistory("k4", fetchFn);
      await useChatHistoryStore.getState().fetchHistory("k4", fetchFn, { force: true });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it("deduplicates concurrent requests for the same key", async () => {
      let resolveP: (v: SessionEvent[]) => void;
      const fetchFn = vi.fn<() => Promise<SessionEvent[]>>(
        () => new Promise((r) => { resolveP = r; }),
      );
      const p1 = useChatHistoryStore.getState().fetchHistory("k5", fetchFn);
      const p2 = useChatHistoryStore.getState().fetchHistory("k5", fetchFn);
      resolveP!([makeMsg("m1")]);
      await Promise.all([p1, p2]);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it("caps retained events per history entry", async () => {
      const msgs = Array.from({ length: 501 }, (_, i) => makeMsg(`m${i}`));
      await useChatHistoryStore.getState().fetchHistory("long", makeFetchFn(msgs));

      const events = useChatHistoryStore.getState().entries.long.events;
      expect(events).toHaveLength(500);
      expect(events[0].id).toBe("m1");
      expect(events.at(-1)?.id).toBe("m500");
    });

    it("caps retained history entries", async () => {
      for (let i = 0; i < 9; i += 1) {
        await useChatHistoryStore.getState().fetchHistory(`k${i}`, makeFetchFn([makeMsg(`m${i}`)]));
      }

      const keys = Object.keys(useChatHistoryStore.getState().entries);
      expect(keys).toHaveLength(8);
      expect(keys).not.toContain("k0");
      expect(keys).toContain("k8");
    });
  });

  describe("prefetchHistory", () => {
    it("calls fetchHistory without throwing", () => {
      const fetchFn = makeFetchFn();
      expect(() => useChatHistoryStore.getState().prefetchHistory("pk", fetchFn)).not.toThrow();
    });
  });

  describe("invalidateHistory", () => {
    it("marks the entry stale for the given key", async () => {
      const fetchFn = makeFetchFn([makeMsg("m1")]);
      await useChatHistoryStore.getState().fetchHistory("k6", fetchFn);
      expect(useChatHistoryStore.getState().entries["k6"]).toBeDefined();

      useChatHistoryStore.getState().invalidateHistory("k6");
      expect(useChatHistoryStore.getState().entries["k6"]?.fetchedAt).toBe(0);
    });
  });

  describe("clearHistory", () => {
    it("replaces cached events with an empty ready entry", async () => {
      const fetchFn = makeFetchFn([makeMsg("m1")]);
      await useChatHistoryStore.getState().fetchHistory("k7", fetchFn);

      useChatHistoryStore.getState().clearHistory("k7");

      expect(useChatHistoryStore.getState().entries["k7"]).toMatchObject({
        events: [],
        status: "ready",
        error: null,
        lastMessageAt: null,
      });
      expect(useChatHistoryStore.getState().previewLastMessages.k7).toBeUndefined();
    });
  });

  describe("key helpers", () => {
    it("agentHistoryKey", () => {
      expect(agentHistoryKey("a1")).toBe("agent:a1");
    });

    it("projectChatHistoryKey", () => {
      expect(projectChatHistoryKey("p1", "ai1")).toBe("project:p1:ai1");
    });
  });
});
