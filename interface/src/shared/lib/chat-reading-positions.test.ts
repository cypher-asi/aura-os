import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearChatPositions, followChatPosition, readChatPosition, rememberChatPosition } from "./chat-reading-positions";
const identity = vi.hoisted(() => ({ user: "user-a" as string | null, host: "https://host-a" }));
vi.mock("./auth-token", () => ({ getStoredSession: () => identity.user ? { user_id: identity.user } : null }));
vi.mock("./host-config", () => ({ getResolvedHostOrigin: () => identity.host }));
const storageKey = "aura-chat-reading-positions-v1";

describe("chat reading positions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    identity.user = "user-a";
    identity.host = "https://host-a";
    clearChatPositions();
  });
  afterEach(() => { clearChatPositions(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const position = { rowId: "message-1", offsetWithinRow: 12, scrollOffset: 512, atEnd: false };
  it("isolates transcript keys and clears session memory", () => {
    rememberChatPosition("project:one:session:a", position);
    expect(readChatPosition("project:one:session:b")).toBeUndefined();
    expect(readChatPosition("project:two:session:a")).toBeUndefined();
    expect(readChatPosition("project:one:session:a")).toEqual(position);
    clearChatPositions();
    expect(readChatPosition("project:one:session:a")).toBeUndefined();
  });
  it("bounds memory to 100 recently saved positions", () => {
    for (let i = 0; i < 100; i++) rememberChatPosition(String(i), position);
    rememberChatPosition("0", position);
    rememberChatPosition("100", position);
    expect(readChatPosition("0")).toEqual(position);
    expect(readChatPosition("1")).toBeUndefined();
  });
  it("explicitly following cancels a remembered reading position", () => {
    rememberChatPosition("one", position);
    followChatPosition("one");
    expect(readChatPosition("one")?.atEnd).toBe(true);
  });

  it("restores positions and follow mode from disk in a fresh module instance", async () => {
    rememberChatPosition("reading", position);
    rememberChatPosition("latest", position);
    followChatPosition("latest");
    await vi.advanceTimersByTimeAsync(250);
    vi.resetModules();
    const restarted = await import("./chat-reading-positions");
    expect(restarted.readChatPosition("reading")).toEqual(position);
    expect(restarted.readChatPosition("latest")?.atEnd).toBe(true);
    restarted.clearChatPositions();
  });

  it("flushes the latest offset on close, and logout cannot resurrect pending writes", async () => {
    rememberChatPosition("reading", position);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(window.localStorage.getItem(storageKey)!).positions[0][1]).toEqual(position);
    rememberChatPosition("reading", { ...position, scrollOffset: 900 });
    clearChatPositions();
    await vi.advanceTimersByTimeAsync(1000);
    window.dispatchEvent(new Event("pagehide"));
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it("does not hydrate or leak a pending save into another account or host", async () => {
    rememberChatPosition("same-chat", position);
    await vi.advanceTimersByTimeAsync(250);
    identity.user = "user-b";
    expect(readChatPosition("same-chat")).toBeUndefined();
    identity.user = "user-a";
    expect(readChatPosition("same-chat")).toEqual(position);
    rememberChatPosition("not-flushed", position);
    identity.host = "https://host-b";
    expect(readChatPosition("same-chat")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(250);
    expect(JSON.parse(window.localStorage.getItem(storageKey)!).owner).toContain("host-a");
  });

  it("does not persist anonymous/public-chat state", async () => {
    identity.user = null;
    rememberChatPosition("public", position);
    await vi.advanceTimersByTimeAsync(1000);
    expect(readChatPosition("public")).toEqual(position);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it.each(["{broken", JSON.stringify({ version: 99 }), JSON.stringify({ version: 1, owner: '["https://host-a","user-a"]', positions: [["bad", { ...position, scrollOffset: -1 }]] })])(
    "ignores invalid persisted records: %s", (raw) => {
      window.localStorage.setItem(storageKey, raw);
      expect(readChatPosition("bad")).toBeUndefined();
    },
  );

  it("survives unavailable storage and quota errors with a memory fallback", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    expect(() => rememberChatPosition("reading", position)).not.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(readChatPosition("reading")).toEqual(position);
    expect(() => clearChatPositions()).not.toThrow();
  });
});
