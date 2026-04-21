import { describe, it, expect, beforeEach, vi } from "vitest";

// Install a minimal localStorage stub *before* loading the module under
// test. The repo's vitest setup passes `--localstorage-file` without a
// valid path, which leaves jsdom's `localStorage` without `setItem` /
// `removeItem` / `clear` in this project — so every storage-touching
// test installs its own Map-backed stub (see `auth-store.test.ts`).
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

import {
  BROWSER_DB_STORES,
  browserDbGet,
  browserDbSet,
  purgeLegacyChatHistoryFallback,
} from "./browser-db";

// Drop IDB support so the code takes the localStorage-fallback path. The
// real production path writes through to IDB first and mirrors to
// localStorage afterward — the behavior we care about here (no chatHistory
// mirror, quota errors are swallowed) is identical in both paths.
beforeEach(() => {
  // @ts-expect-error - deleting indexedDB on jsdom window is allowed
  delete (window as unknown as { indexedDB?: unknown }).indexedDB;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("browserDbSet", () => {
  it("does NOT mirror chatHistory writes to localStorage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await browserDbSet(BROWSER_DB_STORES.chatHistory, "agent:1", {
      events: [{ id: "x" }],
    });
    const touched = setItem.mock.calls.some(([k]) =>
      typeof k === "string" && k.includes("chatHistory"),
    );
    expect(touched).toBe(false);
  });

  it("still mirrors small fallback stores (auth, org, ui, ...) to localStorage", async () => {
    await browserDbSet(BROWSER_DB_STORES.ui, "panel", { open: true });
    const raw = window.localStorage.getItem("aura-idb:ui:panel");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ open: true });
  });

  it("resolves without throwing when localStorage.setItem throws (e.g. quota)", async () => {
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    try {
      await expect(
        browserDbSet(BROWSER_DB_STORES.ui, "panel", { open: true }),
      ).resolves.toBeUndefined();
      expect(setItem).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("browserDbGet", () => {
  it("returns null for chatHistory keys regardless of legacy localStorage entries", async () => {
    window.localStorage.setItem(
      "aura-idb:chatHistory:agent:legacy",
      JSON.stringify({ events: [{ id: "old" }] }),
    );
    const got = await browserDbGet(
      BROWSER_DB_STORES.chatHistory,
      "agent:legacy",
    );
    expect(got).toBeNull();
  });
});

describe("purgeLegacyChatHistoryFallback", () => {
  it("removes chatHistory mirror keys and leaves other stores alone", () => {
    window.localStorage.setItem(
      "aura-idb:chatHistory:agent:a",
      JSON.stringify({}),
    );
    window.localStorage.setItem(
      "aura-idb:chatHistory:agent:b",
      JSON.stringify({}),
    );
    window.localStorage.setItem(
      "aura-idb:ui:panel",
      JSON.stringify({ open: true }),
    );
    window.localStorage.setItem("unrelated-key", "value");

    purgeLegacyChatHistoryFallback();

    expect(
      window.localStorage.getItem("aura-idb:chatHistory:agent:a"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("aura-idb:chatHistory:agent:b"),
    ).toBeNull();
    expect(window.localStorage.getItem("aura-idb:ui:panel")).not.toBeNull();
    expect(window.localStorage.getItem("unrelated-key")).toBe("value");
  });
});
