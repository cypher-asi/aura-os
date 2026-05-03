import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_DARK_ID,
  BUILT_IN_LIGHT_ID,
  BUILT_IN_PRESETS,
  createPresetId,
  getPresetForResolvedTheme,
  loadPresets,
  parsePresetFromImport,
  savePresets,
  serializePresetForExport,
  type StoredPresets,
  type ThemePreset,
} from "./theme-presets";

const STORAGE_KEY = "aura-theme-presets";

describe("theme-presets", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("loadPresets / savePresets", () => {
    it("returns built-ins and null active when storage is empty", () => {
      const state = loadPresets();
      expect(state.version).toBe(1);
      expect(state.active).toEqual({ dark: null, light: null });
      const ids = state.presets.map((p) => p.id);
      expect(ids).toContain(BUILT_IN_DARK_ID);
      expect(ids).toContain(BUILT_IN_LIGHT_ID);
    });

    it("returns built-ins and defaults when JSON is malformed", () => {
      localStorage.setItem(STORAGE_KEY, "{not valid json");
      const state = loadPresets();
      expect(state.active).toEqual({ dark: null, light: null });
      expect(state.presets.map((p) => p.id)).toEqual([
        BUILT_IN_DARK_ID,
        BUILT_IN_LIGHT_ID,
      ]);
    });

    it("round-trips a saved store, preserving user presets", () => {
      const userPreset: ThemePreset = {
        id: "user-1",
        name: "Twilight",
        base: "dark",
        overrides: { "--color-border": "#102030" },
        version: 1,
      };
      const next: StoredPresets = {
        presets: [...BUILT_IN_PRESETS, userPreset],
        active: { dark: "user-1", light: null },
        version: 1,
      };
      savePresets(next);

      const loaded = loadPresets();
      expect(loaded.active).toEqual({ dark: "user-1", light: null });
      const found = loaded.presets.find((p) => p.id === "user-1");
      expect(found).toBeDefined();
      expect(found?.overrides).toEqual({ "--color-border": "#102030" });
    });

    it("re-injects a missing built-in even if storage tampered with it", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          presets: [
            {
              id: "user-1",
              name: "Twilight",
              base: "dark",
              overrides: {},
              version: 1,
            },
          ],
          active: { dark: null, light: null },
          version: 1,
        }),
      );
      const state = loadPresets();
      const ids = state.presets.map((p) => p.id);
      expect(ids).toContain(BUILT_IN_DARK_ID);
      expect(ids).toContain(BUILT_IN_LIGHT_ID);
      expect(ids).toContain("user-1");
    });

    it("forces built-in identity when the persisted blob mutated them", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          presets: [
            {
              id: BUILT_IN_DARK_ID,
              name: "Hacked",
              base: "dark",
              overrides: { "--color-border": "#ff00ff" },
              version: 1,
            },
          ],
          active: { dark: null, light: null },
          version: 1,
        }),
      );
      const dark = loadPresets().presets.find(
        (p) => p.id === BUILT_IN_DARK_ID,
      );
      expect(dark?.name).toBe("Aura Dark");
      expect(dark?.overrides).toEqual({});
      expect(dark?.readOnly).toBe(true);
    });

    it("drops unknown override tokens when loading", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          presets: [
            {
              id: "user-1",
              name: "X",
              base: "dark",
              overrides: {
                "--color-border": "#123",
                "--bogus": "#abc",
                "--color-sidebar-bg": 42,
              },
              version: 1,
            },
          ],
          active: { dark: null, light: null },
          version: 1,
        }),
      );
      const found = loadPresets().presets.find((p) => p.id === "user-1");
      expect(found?.overrides).toEqual({ "--color-border": "#123" });
    });

    it("clears an active id that points at a missing or mismatched preset", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          presets: [],
          active: { dark: "nope", light: BUILT_IN_DARK_ID },
          version: 1,
        }),
      );
      const state = loadPresets();
      expect(state.active.dark).toBeNull();
      expect(state.active.light).toBeNull();
    });
  });

  describe("getPresetForResolvedTheme", () => {
    it("returns the active preset for the requested resolved theme", () => {
      const userPreset: ThemePreset = {
        id: "user-1",
        name: "Twilight",
        base: "dark",
        overrides: {},
        version: 1,
      };
      const state: StoredPresets = {
        presets: [...BUILT_IN_PRESETS, userPreset],
        active: { dark: "user-1", light: null },
        version: 1,
      };
      expect(getPresetForResolvedTheme(state, "dark")?.id).toBe("user-1");
      expect(getPresetForResolvedTheme(state, "light")).toBeNull();
    });

    it("returns null when active id no longer matches any preset", () => {
      const state: StoredPresets = {
        presets: [...BUILT_IN_PRESETS],
        active: { dark: "ghost", light: null },
        version: 1,
      };
      expect(getPresetForResolvedTheme(state, "dark")).toBeNull();
    });
  });

  describe("serializePresetForExport / parsePresetFromImport", () => {
    it("round-trips a user preset, dropping readOnly and assigning a fresh id", () => {
      const original: ThemePreset = {
        id: "user-1",
        name: "Twilight",
        base: "dark",
        overrides: { "--color-border": "#102030" },
        version: 1,
      };
      const json = serializePresetForExport(original);
      const result = parsePresetFromImport(json);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.preset.id).not.toBe(original.id);
      expect(result.preset.name).toBe("Twilight");
      expect(result.preset.base).toBe("dark");
      expect(result.preset.overrides).toEqual({ "--color-border": "#102030" });
      expect(result.preset.readOnly).toBeUndefined();
    });

    it("strips readOnly when exporting a built-in", () => {
      const json = serializePresetForExport(BUILT_IN_PRESETS[0]);
      expect(json).not.toContain("readOnly");
      const result = parsePresetFromImport(json);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.preset.readOnly).toBeUndefined();
    });

    it("assigns a different id on each import of the same JSON", () => {
      const original: ThemePreset = {
        id: "user-1",
        name: "Twilight",
        base: "dark",
        overrides: {},
        version: 1,
      };
      const json = serializePresetForExport(original);
      const a = parsePresetFromImport(json);
      const b = parsePresetFromImport(json);
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) {
        expect(a.preset.id).not.toBe(b.preset.id);
      }
    });

    it("rejects malformed JSON with ok: false and a reason", () => {
      const result = parsePresetFromImport("{not json");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/json/i);
    });

    it.each([
      ['"a string"', /object/i],
      ['{"name":"","base":"dark","overrides":{}}', /name/i],
      ['{"name":"x","base":"chartreuse","overrides":{}}', /base/i],
      ['{"name":"x","base":"dark","overrides":42}', /overrides/i],
    ])("rejects %s", (input, pattern) => {
      const result = parsePresetFromImport(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(pattern);
    });
  });

  describe("createPresetId", () => {
    it("uses crypto.randomUUID when available", () => {
      const spy = vi
        .spyOn(crypto, "randomUUID")
        .mockReturnValue("11111111-2222-3333-4444-555555555555");
      expect(createPresetId()).toBe("11111111-2222-3333-4444-555555555555");
      spy.mockRestore();
    });

    it("falls back when crypto.randomUUID is missing", () => {
      const original = (
        crypto as unknown as { randomUUID?: () => string }
      ).randomUUID;
      try {
        // @ts-expect-error simulating older runtimes
        delete (crypto as { randomUUID?: () => string }).randomUUID;
        const id = createPresetId();
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
      } finally {
        if (original) {
          (crypto as unknown as { randomUUID: () => string }).randomUUID =
            original;
        }
      }
    });
  });
});
