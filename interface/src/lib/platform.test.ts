import { afterEach, describe, expect, it } from "vitest";
import {
  __setIsMacForTesting,
  formatShortcut,
  matchesShortcut,
  type ShortcutSpec,
} from "./platform";

afterEach(() => {
  __setIsMacForTesting(null);
});

describe("formatShortcut on Windows/Linux", () => {
  it.each<{ spec: ShortcutSpec; expected: string }>([
    { spec: { key: "n", mod: true }, expected: "Ctrl+N" },
    { spec: { key: "n", mod: true, shift: true }, expected: "Ctrl+Shift+N" },
    { spec: { key: ",", mod: true }, expected: "Ctrl+," },
    { spec: { key: "w", mod: true }, expected: "Ctrl+W" },
    { spec: { key: "F11" }, expected: "F11" },
    { spec: { key: "Delete" }, expected: "Delete" },
    { spec: { key: "ArrowLeft", mod: true, alt: true }, expected: "Ctrl+Alt+Left" },
  ])("renders $spec.key with modifiers", ({ spec, expected }) => {
    __setIsMacForTesting(false);
    expect(formatShortcut(spec)).toBe(expected);
  });
});

describe("formatShortcut on macOS", () => {
  it.each<{ spec: ShortcutSpec; expected: string }>([
    { spec: { key: "n", mod: true }, expected: "⌘N" },
    { spec: { key: "n", mod: true, shift: true }, expected: "⇧⌘N" },
    { spec: { key: "ArrowLeft", mod: true, alt: true }, expected: "⌥⌘←" },
    { spec: { key: "F11" }, expected: "F11" },
  ])("renders $spec.key as Mac glyphs", ({ spec, expected }) => {
    __setIsMacForTesting(true);
    expect(formatShortcut(spec)).toBe(expected);
  });
});

function makeEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key: init.key ?? "",
    ctrlKey: Boolean(init.ctrlKey),
    metaKey: Boolean(init.metaKey),
    shiftKey: Boolean(init.shiftKey),
    altKey: Boolean(init.altKey),
  });
}

describe("matchesShortcut", () => {
  it("matches Ctrl+N on Windows", () => {
    __setIsMacForTesting(false);
    expect(matchesShortcut(makeEvent({ key: "n", ctrlKey: true }), { key: "n", mod: true })).toBe(true);
  });

  it("does not match Ctrl+N on macOS (mod = Cmd)", () => {
    __setIsMacForTesting(true);
    expect(matchesShortcut(makeEvent({ key: "n", ctrlKey: true }), { key: "n", mod: true })).toBe(false);
  });

  it("matches Cmd+N on macOS", () => {
    __setIsMacForTesting(true);
    expect(matchesShortcut(makeEvent({ key: "n", metaKey: true }), { key: "n", mod: true })).toBe(true);
  });

  it("rejects when shift modifier mismatches", () => {
    __setIsMacForTesting(false);
    expect(
      matchesShortcut(makeEvent({ key: "n", ctrlKey: true }), {
        key: "n",
        mod: true,
        shift: true,
      }),
    ).toBe(false);
    expect(
      matchesShortcut(makeEvent({ key: "n", ctrlKey: true, shiftKey: true }), {
        key: "n",
        mod: true,
        shift: true,
      }),
    ).toBe(true);
  });

  it("rejects bare key when shortcut requires Ctrl", () => {
    __setIsMacForTesting(false);
    expect(matchesShortcut(makeEvent({ key: "n" }), { key: "n", mod: true })).toBe(false);
  });

  it("rejects modified press when shortcut is bare", () => {
    __setIsMacForTesting(false);
    expect(
      matchesShortcut(makeEvent({ key: "F11", ctrlKey: true }), { key: "F11" }),
    ).toBe(false);
    expect(matchesShortcut(makeEvent({ key: "F11" }), { key: "F11" })).toBe(true);
  });
});
