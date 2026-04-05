import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { createSidekickSlice, type SidekickSliceState } from "./sidekick-slice";

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
});
