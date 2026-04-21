import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { create } from "zustand";

// Install a Map-backed localStorage stub before the module under test loads.
// The repo's vitest setup passes `--localstorage-file` without a valid path,
// which leaves jsdom's `localStorage` without `setItem` / `removeItem` / `clear`.
// See `browser-db.test.ts` / `auth-store.test.ts` for the same pattern.
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
  createSidekickSlice,
  persistActiveTab,
  type SidekickSliceState,
} from "./sidekick-slice";

type TestTab = "tab1" | "tab2" | "tab3";
type TestPreview = { id: number; name: string };

type TestState = SidekickSliceState<TestTab, TestPreview>;

function createTestStore(defaultTab: TestTab = "tab1") {
  return create<TestState>()((set, get) => ({
    ...createSidekickSlice<TestTab, TestPreview>(defaultTab, set, get),
  }));
}

describe("createSidekickSlice", () => {
  describe("tab switching", () => {
    it("initializes with the provided default tab", () => {
      const store = createTestStore("tab2");
      expect(store.getState().activeTab).toBe("tab2");
    });

    it("switches to a new tab", () => {
      const store = createTestStore();
      store.getState().setActiveTab("tab3");
      expect(store.getState().activeTab).toBe("tab3");
    });

    it("clears preview state on tab switch", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "first" });
      store.getState().pushPreview({ id: 2, name: "second" });

      store.getState().setActiveTab("tab2");
      expect(store.getState().previewItem).toBeNull();
      expect(store.getState().previewHistory).toEqual([]);
      expect(store.getState().canGoBack).toBe(false);
    });
  });

  describe("preview stack push/pop/clear", () => {
    it("pushPreview sets the current item when stack is empty", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "first" });
      expect(store.getState().previewItem).toEqual({ id: 1, name: "first" });
      expect(store.getState().previewHistory).toEqual([]);
    });

    it("pushPreview moves current item to history", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "first" });
      store.getState().pushPreview({ id: 2, name: "second" });

      expect(store.getState().previewItem).toEqual({ id: 2, name: "second" });
      expect(store.getState().previewHistory).toEqual([{ id: 1, name: "first" }]);
    });

    it("popPreview restores the previous item from history", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "first" });
      store.getState().pushPreview({ id: 2, name: "second" });
      store.getState().popPreview();

      expect(store.getState().previewItem).toEqual({ id: 1, name: "first" });
      expect(store.getState().previewHistory).toEqual([]);
    });

    it("popPreview is a no-op when history is empty", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "only" });
      store.getState().popPreview();
      expect(store.getState().previewItem).toEqual({ id: 1, name: "only" });
    });

    it("popPreview is a no-op when completely empty", () => {
      const store = createTestStore();
      store.getState().popPreview();
      expect(store.getState().previewItem).toBeNull();
    });

    it("clearPreviews resets the entire preview stack", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "first" });
      store.getState().pushPreview({ id: 2, name: "second" });
      store.getState().pushPreview({ id: 3, name: "third" });
      store.getState().clearPreviews();

      expect(store.getState().previewItem).toBeNull();
      expect(store.getState().previewHistory).toEqual([]);
      expect(store.getState().canGoBack).toBe(false);
    });

    it("supports deep stacks with multiple pushes and pops", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "a" });
      store.getState().pushPreview({ id: 2, name: "b" });
      store.getState().pushPreview({ id: 3, name: "c" });

      expect(store.getState().previewHistory).toHaveLength(2);

      store.getState().popPreview();
      expect(store.getState().previewItem).toEqual({ id: 2, name: "b" });
      store.getState().popPreview();
      expect(store.getState().previewItem).toEqual({ id: 1, name: "a" });
      store.getState().popPreview();
      expect(store.getState().previewItem).toEqual({ id: 1, name: "a" });
    });
  });

  describe("canGoBack derivation", () => {
    it("is false initially", () => {
      const store = createTestStore();
      expect(store.getState().canGoBack).toBe(false);
    });

    it("is false with a single preview item (no history)", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "first" });
      expect(store.getState().canGoBack).toBe(false);
    });

    it("is true when history has at least one entry", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "first" });
      store.getState().pushPreview({ id: 2, name: "second" });
      expect(store.getState().canGoBack).toBe(true);
    });

    it("becomes false after popping back to a single item", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "first" });
      store.getState().pushPreview({ id: 2, name: "second" });
      store.getState().popPreview();
      expect(store.getState().canGoBack).toBe(false);
    });

    it("becomes false after clearPreviews", () => {
      const store = createTestStore();
      store.getState().pushPreview({ id: 1, name: "first" });
      store.getState().pushPreview({ id: 2, name: "second" });
      store.getState().clearPreviews();
      expect(store.getState().canGoBack).toBe(false);
    });
  });

  describe("factory with different tab type parameters", () => {
    it("works with string literal union for tabs", () => {
      type AlphaTab = "alpha" | "beta" | "gamma";
      type AlphaState = SidekickSliceState<AlphaTab, string>;
      const store = create<AlphaState>()((set, get) => ({
        ...createSidekickSlice<AlphaTab, string>("alpha", set, get),
      }));

      expect(store.getState().activeTab).toBe("alpha");
      store.getState().setActiveTab("gamma");
      expect(store.getState().activeTab).toBe("gamma");
    });

    it("works with complex preview types", () => {
      type ComplexPreview = { kind: "a"; value: number } | { kind: "b"; label: string };
      type CTab = "x" | "y";
      type CState = SidekickSliceState<CTab, ComplexPreview>;
      const store = create<CState>()((set, get) => ({
        ...createSidekickSlice<CTab, ComplexPreview>("x", set, get),
      }));

      store.getState().pushPreview({ kind: "a", value: 42 });
      store.getState().pushPreview({ kind: "b", label: "hello" });

      expect(store.getState().previewItem).toEqual({ kind: "b", label: "hello" });
      expect(store.getState().previewHistory).toEqual([{ kind: "a", value: 42 }]);

      store.getState().popPreview();
      expect(store.getState().previewItem).toEqual({ kind: "a", value: 42 });
    });

    it("works with simple string preview type", () => {
      type SState = SidekickSliceState<"one" | "two", string>;
      const store = create<SState>()((set, get) => ({
        ...createSidekickSlice<"one" | "two", string>("one", set, get),
      }));

      store.getState().pushPreview("hello");
      expect(store.getState().previewItem).toBe("hello");
    });
  });

  describe("persistence", () => {
    const STORAGE_KEY = "test-sidekick-tab";
    const isValidTab = (v: string): v is TestTab =>
      v === "tab1" || v === "tab2" || v === "tab3";

    beforeEach(() => {
      window.localStorage.removeItem(STORAGE_KEY);
    });

    afterEach(() => {
      window.localStorage.removeItem(STORAGE_KEY);
    });

    function createPersistedStore(defaultTab: TestTab = "tab1") {
      return create<TestState>()((set, get) => ({
        ...createSidekickSlice<TestTab, TestPreview>(defaultTab, set, get, {
          storageKey: STORAGE_KEY,
          isValidTab,
        }),
      }));
    }

    it("restores a valid persisted tab on init", () => {
      window.localStorage.setItem(STORAGE_KEY, "tab3");
      const store = createPersistedStore("tab1");
      expect(store.getState().activeTab).toBe("tab3");
    });

    it("falls back to defaultTab when storage is empty", () => {
      const store = createPersistedStore("tab2");
      expect(store.getState().activeTab).toBe("tab2");
    });

    it("falls back to defaultTab when stored value is invalid", () => {
      window.localStorage.setItem(STORAGE_KEY, "not-a-real-tab");
      const store = createPersistedStore("tab1");
      expect(store.getState().activeTab).toBe("tab1");
    });

    it("writes to storage on setActiveTab", () => {
      const store = createPersistedStore("tab1");
      store.getState().setActiveTab("tab2");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("tab2");
    });

    it("persistActiveTab helper writes the given value", () => {
      persistActiveTab(STORAGE_KEY, "tab3");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("tab3");
    });

    it("does not throw when localStorage.setItem throws", () => {
      const originalSetItem = window.localStorage.setItem;
      window.localStorage.setItem = vi.fn(() => {
        throw new Error("quota exceeded");
      });
      try {
        const store = createPersistedStore("tab1");
        expect(() => store.getState().setActiveTab("tab2")).not.toThrow();
        expect(store.getState().activeTab).toBe("tab2");
      } finally {
        window.localStorage.setItem = originalSetItem;
      }
    });

    it("does not throw when localStorage.getItem throws at init", () => {
      const originalGetItem = window.localStorage.getItem;
      window.localStorage.getItem = vi.fn(() => {
        throw new Error("disabled");
      });
      try {
        expect(() => createPersistedStore("tab2")).not.toThrow();
        const store = createPersistedStore("tab2");
        expect(store.getState().activeTab).toBe("tab2");
      } finally {
        window.localStorage.getItem = originalGetItem;
      }
    });

    it("no-ops when persistence config is not provided", () => {
      window.localStorage.setItem(STORAGE_KEY, "tab3");
      const store = createTestStore("tab1");
      expect(store.getState().activeTab).toBe("tab1");
      store.getState().setActiveTab("tab2");
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("tab3");
    });
  });
});
