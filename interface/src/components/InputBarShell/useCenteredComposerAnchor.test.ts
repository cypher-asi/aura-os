import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCenteredComposerAnchor } from "./useCenteredComposerAnchor";

let resized: () => void;
const disconnect = vi.fn();
const observe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe = observe;
    disconnect = disconnect;
  });
});
afterEach(() => vi.unstubAllGlobals());

function layout() {
  const root = document.createElement("div");
  const textarea = document.createElement("textarea");
  const state = { notice: 0, hidden: false, footer: 40 };
  const rootHeight = () => 100 + state.notice + state.footer;
  const rootTop = () => 300 - rootHeight() + (Number.parseFloat(root.style.getPropertyValue("--centered-composer-offset")) || rootHeight() / 2);
  vi.spyOn(root, "getBoundingClientRect").mockImplementation(() => DOMRect.fromRect({ y: rootTop(), width: 360, height: state.hidden ? 0 : rootHeight() }));
  vi.spyOn(textarea, "getBoundingClientRect").mockImplementation(() => DOMRect.fromRect({ y: rootTop() + 60 + state.notice, width: state.hidden ? 0 : 300, height: 40 }));
  const center = () => textarea.getBoundingClientRect().top + 20;
  return { root, textarea, state, center, rootRef: { current: root }, textareaRef: { current: textarea } };
}

it("preserves the original placement and keeps the typing target steady as notices grow and disappear", () => {
  const box = layout();
  const initial = box.center();
  renderHook(() => useCenteredComposerAnchor(box.rootRef, box.textareaRef, true));
  expect(box.center()).toBe(initial);
  for (const height of [48, 96, 28, 0, 144]) {
    act(() => { box.state.notice = height; resized(); });
    expect(box.center()).toBe(initial);
  }
  expect(observe).toHaveBeenCalledWith(box.root);
  expect(observe).toHaveBeenCalledWith(box.textarea);
});

it("also accounts for a footer changing below the typing field", () => {
  const box = layout();
  renderHook(() => useCenteredComposerAnchor(box.rootRef, box.textareaRef, true));
  const initial = box.center();
  act(() => { box.state.footer += 30; resized(); });
  expect(box.center()).toBe(initial);
});

it("releases the override and observer on docking, then calibrates a new centered session", () => {
  const box = layout();
  const { rerender, unmount } = renderHook(({ enabled }) => useCenteredComposerAnchor(box.rootRef, box.textareaRef, enabled), { initialProps: { enabled: true } });
  rerender({ enabled: false });
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(box.root.style.getPropertyValue("--centered-composer-offset")).toBe("");
  box.state.notice = 48;
  const initial = box.center();
  rerender({ enabled: true });
  expect(box.center()).toBe(initial);
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});

it("defers calibration until a hidden input has measurable geometry", () => {
  const box = layout();
  box.state.hidden = true;
  renderHook(() => useCenteredComposerAnchor(box.rootRef, box.textareaRef, true));
  expect(box.root.style.getPropertyValue("--centered-composer-offset")).toBe("");
  box.state.hidden = false;
  const initial = box.center();
  act(() => resized());
  expect(box.center()).toBe(initial);
});

it("leaves the CSS fallback in place without ResizeObserver", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const box = layout();
  renderHook(() => useCenteredComposerAnchor(box.rootRef, box.textareaRef, true));
  expect(box.root.style.getPropertyValue("--centered-composer-offset")).toBe("");
});
