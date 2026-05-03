import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedTheme } from "@cypher-asi/zui";
import { useThemeOverrides } from "./use-theme-overrides";
import {
  BUILT_IN_DARK_ID,
  BUILT_IN_LIGHT_ID,
  type StoredPresets,
} from "../lib/theme-presets";

const STORAGE_KEY = "aura-theme-overrides";
const PRESETS_KEY = "aura-theme-presets";

const useThemeMock = vi.fn<() => { resolvedTheme: ResolvedTheme }>();

vi.mock("@cypher-asi/zui", () => ({
  useTheme: () => useThemeMock(),
}));

describe("useThemeOverrides", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    useThemeMock.mockReset();
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    vi.restoreAllMocks();
  });

  it("hydrates the active override set from localStorage on mount", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#ff0000" },
        light: { "--color-border": "#0000ff" },
      }),
    );

    const { result } = renderHook(() => useThemeOverrides());

    expect(result.current.overrides).toEqual({ "--color-border": "#ff0000" });
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#ff0000");
  });

  it("setToken persists the override and writes the inline style", () => {
    const { result } = renderHook(() => useThemeOverrides());

    act(() => {
      result.current.setToken("--color-border", "#123456");
    });

    expect(result.current.overrides["--color-border"]).toBe("#123456");
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#123456");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored).toEqual({
      dark: { "--color-border": "#123456" },
      light: {},
    });
  });

  it("setToken with null clears the override and removes the inline style", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#abcdef" },
        light: {},
      }),
    );
    const { result } = renderHook(() => useThemeOverrides());
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#abcdef");

    act(() => {
      result.current.setToken("--color-border", null);
    });

    expect(result.current.overrides["--color-border"]).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.dark).toEqual({});
  });

  it("resetAll clears the active resolvedTheme and leaves the other alone", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#111111" },
        light: { "--color-border": "#eeeeee" },
      }),
    );
    const { result } = renderHook(() => useThemeOverrides());

    act(() => {
      result.current.resetAll();
    });

    expect(result.current.overrides).toEqual({});
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored).toEqual({
      dark: {},
      light: { "--color-border": "#eeeeee" },
    });
  });

  it("re-applies the matching side when resolvedTheme changes", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#111111" },
        light: { "--color-border": "#eeeeee" },
      }),
    );
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    const { result, rerender } = renderHook(() => useThemeOverrides());

    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#111111");

    useThemeMock.mockReturnValue({ resolvedTheme: "light" });
    rerender();

    expect(result.current.overrides).toEqual({ "--color-border": "#eeeeee" });
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#eeeeee");
  });

  it("exposes built-in presets filtered to the current resolvedTheme", () => {
    const { result, rerender } = renderHook(() => useThemeOverrides());

    expect(result.current.presets.map((p) => p.id)).toEqual([
      BUILT_IN_DARK_ID,
    ]);

    useThemeMock.mockReturnValue({ resolvedTheme: "light" });
    rerender();

    expect(result.current.presets.map((p) => p.id)).toEqual([
      BUILT_IN_LIGHT_ID,
    ]);
  });

  it("selecting a built-in clears working-set inline styles in favor of the preset", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#abcdef" },
        light: {},
      }),
    );
    const { result } = renderHook(() => useThemeOverrides());
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#abcdef");

    act(() => {
      result.current.selectPreset(BUILT_IN_DARK_ID);
    });

    expect(result.current.activePresetId).toBe(BUILT_IN_DARK_ID);
    expect(result.current.overrides).toEqual({});
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("");
  });

  it("selectPreset(null) falls back to the working set", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#abcdef" },
        light: {},
      }),
    );
    const { result } = renderHook(() => useThemeOverrides());
    act(() => {
      result.current.selectPreset(BUILT_IN_DARK_ID);
    });
    expect(result.current.overrides).toEqual({});

    act(() => {
      result.current.selectPreset(null);
    });
    expect(result.current.activePresetId).toBeNull();
    expect(result.current.overrides).toEqual({ "--color-border": "#abcdef" });
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#abcdef");
  });

  it("createPresetFromCurrent snapshots applied overrides into a new preset and selects it", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-1111-2222-3333-444444444444",
    );
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#abcdef" },
        light: {},
      }),
    );
    const { result } = renderHook(() => useThemeOverrides());

    let created: ReturnType<typeof result.current.createPresetFromCurrent> | null =
      null;
    act(() => {
      created = result.current.createPresetFromCurrent("My Theme");
    });

    expect(created).toMatchObject({
      id: "00000000-1111-2222-3333-444444444444",
      name: "My Theme",
      base: "dark",
      overrides: { "--color-border": "#abcdef" },
      version: 1,
    });
    expect(result.current.activePresetId).toBe(
      "00000000-1111-2222-3333-444444444444",
    );
    expect(result.current.overrides).toEqual({ "--color-border": "#abcdef" });

    const stored = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
    expect(
      stored.presets.find(
        (p: { id: string }) =>
          p.id === "00000000-1111-2222-3333-444444444444",
      ),
    ).toBeDefined();
    expect(stored.active.dark).toBe("00000000-1111-2222-3333-444444444444");
  });

  it("setToken on an active editable preset mutates the preset, not the working set", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "22222222-2222-2222-2222-222222222222",
    );
    const { result } = renderHook(() => useThemeOverrides());
    act(() => {
      result.current.createPresetFromCurrent("My Theme");
    });

    act(() => {
      result.current.setToken("--color-border", "#112233");
    });

    expect(result.current.overrides["--color-border"]).toBe("#112233");
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("#112233");
    const workingSet = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(workingSet?.dark ?? {}).toEqual({});
    const presets = JSON.parse(
      localStorage.getItem(PRESETS_KEY) ?? "{}",
    ) as StoredPresets;
    const target = presets.presets.find(
      (p) => p.id === "22222222-2222-2222-2222-222222222222",
    );
    expect(target?.overrides).toEqual({ "--color-border": "#112233" });
  });

  it("setToken is a no-op when a built-in (read-only) preset is active", () => {
    const { result } = renderHook(() => useThemeOverrides());
    act(() => {
      result.current.selectPreset(BUILT_IN_DARK_ID);
    });

    act(() => {
      result.current.setToken("--color-border", "#999999");
    });

    expect(result.current.overrides["--color-border"]).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--color-border"),
    ).toBe("");
  });

  it("renamePreset renames a user preset but no-ops on built-ins", () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(userId);
    const { result } = renderHook(() => useThemeOverrides());
    act(() => {
      result.current.createPresetFromCurrent("Original");
    });

    act(() => {
      result.current.renamePreset(userId, "Renamed");
    });
    expect(result.current.presets.find((p) => p.id === userId)?.name).toBe(
      "Renamed",
    );

    act(() => {
      result.current.renamePreset(BUILT_IN_DARK_ID, "Hacked");
    });
    expect(
      result.current.presets.find((p) => p.id === BUILT_IN_DARK_ID)?.name,
    ).toBe("Aura Dark");
  });

  it("deletePreset removes user presets and falls back to working set when active", () => {
    const userId = "11111111-1111-1111-1111-111111111111";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(userId);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        dark: { "--color-border": "#fallback" },
        light: {},
      }),
    );
    const { result } = renderHook(() => useThemeOverrides());
    act(() => {
      result.current.createPresetFromCurrent("Disposable");
    });
    expect(result.current.activePresetId).toBe(userId);

    act(() => {
      result.current.deletePreset(userId);
    });

    expect(
      result.current.presets.find((p) => p.id === userId),
    ).toBeUndefined();
    expect(result.current.activePresetId).toBeNull();
    expect(result.current.overrides).toEqual({ "--color-border": "#fallback" });
  });

  it("deletePreset is a no-op for built-ins", () => {
    const { result } = renderHook(() => useThemeOverrides());

    act(() => {
      result.current.deletePreset(BUILT_IN_DARK_ID);
    });

    expect(
      result.current.presets.find((p) => p.id === BUILT_IN_DARK_ID),
    ).toBeDefined();
  });

  it("exportPreset returns pretty JSON with no readOnly flag, importPreset re-adds it with a fresh id", () => {
    const originalId = "33333333-3333-3333-3333-333333333333";
    const importedId = "44444444-4444-4444-4444-444444444444";
    const ids: `${string}-${string}-${string}-${string}-${string}`[] = [
      originalId,
      importedId,
    ];
    let i = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      const next = ids[i++];
      if (!next) throw new Error("ran out of mock UUIDs");
      return next;
    });

    const { result } = renderHook(() => useThemeOverrides());
    act(() => {
      result.current.createPresetFromCurrent("Exportable");
    });
    act(() => {
      result.current.setToken("--color-border", "#abcdef");
    });

    const json = result.current.exportPreset(originalId);
    expect(json).toContain('"name"');
    expect(json).not.toContain("readOnly");
    expect(json).toContain("--color-border");

    let importResult: ReturnType<typeof result.current.importPreset> | null =
      null;
    act(() => {
      importResult = result.current.importPreset(json);
    });
    expect(importResult).not.toBeNull();
    if (!importResult) return;
    const r = importResult as ReturnType<typeof result.current.importPreset>;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preset.id).toBe(importedId);
    expect(r.preset.id).not.toBe(originalId);
    expect(r.preset.overrides).toEqual({ "--color-border": "#abcdef" });

    expect(result.current.presets.find((p) => p.id === importedId)).toBeDefined();
  });

  it("importPreset returns ok: false on malformed JSON", () => {
    const { result } = renderHook(() => useThemeOverrides());

    let importResult: ReturnType<typeof result.current.importPreset> | null =
      null;
    act(() => {
      importResult = result.current.importPreset("{not valid");
    });
    expect(importResult).not.toBeNull();
    if (!importResult) return;
    const r = importResult as ReturnType<typeof result.current.importPreset>;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/json/i);
  });
});
