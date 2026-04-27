import { describe, expect, it, beforeEach } from "vitest";
import type { DisplaySessionEvent } from "../shared/types/stream";
import { useMessageStore } from "./message-store";

function msg(id: string): DisplaySessionEvent {
  return { id, role: "assistant", text: id } as DisplaySessionEvent;
}

beforeEach(() => {
  useMessageStore.setState({ messages: {}, orderedIds: {} });
});

describe("message-store", () => {
  it("caps retained messages per thread", () => {
    useMessageStore
      .getState()
      .setThread("thread", Array.from({ length: 501 }, (_, i) => msg(`m${i}`)));

    const ids = useMessageStore.getState().orderedIds.thread;
    expect(ids).toHaveLength(500);
    expect(ids[0]).toBe("m1");
    expect(ids.at(-1)).toBe("m500");
    expect(useMessageStore.getState().messages.m0).toBeUndefined();
  });

  it("keeps messages referenced by another thread when pruning", () => {
    useMessageStore.getState().setThread("other", [msg("shared")]);
    useMessageStore
      .getState()
      .setThread("thread", [msg("shared"), ...Array.from({ length: 500 }, (_, i) => msg(`m${i}`))]);

    expect(useMessageStore.getState().orderedIds.thread).not.toContain("shared");
    expect(useMessageStore.getState().messages.shared).toBeDefined();
  });
});

