import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "@cypher-asi/zui";
import {
  applyOverridesToDocument,
  loadOverrides,
  saveOverrides,
  type EditableToken,
  type StoredOverrides,
  type ThemeOverrides,
} from "../lib/theme-overrides";
import {
  createPresetId,
  loadPresets,
  parsePresetFromImport,
  savePresets,
  serializePresetForExport,
  type ImportResult,
  type StoredPresets,
  type ThemePreset,
} from "../lib/theme-presets";

export type UseThemeOverridesResult = {
  /**
   * Currently-applied override map for the active resolved theme. Reflects
   * the active preset's overrides when one is selected, otherwise the
   * working set. Mutating it via {@link setToken} writes to whichever layer
   * is currently active (no-op for read-only built-in presets).
   */
  overrides: ThemeOverrides;
  setToken: (token: EditableToken, value: string | null) => void;
  resetAll: () => void;

  /** All presets that target the current resolved theme. */
  presets: ThemePreset[];
  /** Currently active preset id for the current resolved theme. */
  activePresetId: string | null;
  /** Selecting `null` falls back to the working set. */
  selectPreset: (id: string | null) => void;
  /**
   * Snapshot the currently-applied overrides into a new user preset and
   * select it as active. Returns the freshly-created preset.
   */
  createPresetFromCurrent: (name: string) => ThemePreset;
  /** No-op for read-only built-ins. */
  renamePreset: (id: string, name: string) => void;
  /** No-op for read-only built-ins. Falls back to working set if active. */
  deletePreset: (id: string) => void;
  /** Pretty JSON for download. Returns "" if the id is unknown. */
  exportPreset: (id: string) => string;
  /** Validates + adds a new preset from a JSON string. Does not auto-select. */
  importPreset: (raw: string) => ImportResult;
};

function emptyStore(): StoredOverrides {
  return { dark: {}, light: {} };
}

function initialStore(): StoredOverrides {
  if (typeof window === "undefined") return emptyStore();
  return loadOverrides();
}

function initialPresets(): StoredPresets {
  return loadPresets();
}

/**
 * Single applicator + persistence layer for chrome-token customization. The
 * apply layer is preset-aware: when an active preset is set for the current
 * resolved theme, its `overrides` map wins; otherwise the working-set map
 * (persisted at `localStorage["aura-theme-overrides"]`) wins. There is
 * exactly one writer of `documentElement.style` for these tokens.
 */
export function useThemeOverrides(): UseThemeOverridesResult {
  const { resolvedTheme } = useTheme();
  const [store, setStore] = useState<StoredOverrides>(initialStore);
  const [presetState, setPresetState] =
    useState<StoredPresets>(initialPresets);

  const activePresetId = presetState.active[resolvedTheme];
  const activePreset = useMemo(() => {
    if (activePresetId === null) return undefined;
    return presetState.presets.find(
      (p) => p.id === activePresetId && p.base === resolvedTheme,
    );
  }, [activePresetId, presetState.presets, resolvedTheme]);

  const appliedOverrides: ThemeOverrides = activePreset
    ? activePreset.overrides
    : store[resolvedTheme];

  useEffect(() => {
    applyOverridesToDocument(resolvedTheme, appliedOverrides);
  }, [resolvedTheme, appliedOverrides]);

  const setToken = useCallback(
    (token: EditableToken, value: string | null) => {
      if (activePreset?.readOnly) return;

      if (activePreset) {
        const targetId = activePreset.id;
        setPresetState((prev) => {
          const nextPresets = prev.presets.map((p) => {
            if (p.id !== targetId) return p;
            const nextOverrides: ThemeOverrides = { ...p.overrides };
            if (value === null) delete nextOverrides[token];
            else nextOverrides[token] = value;
            return { ...p, overrides: nextOverrides };
          });
          const next: StoredPresets = { ...prev, presets: nextPresets };
          savePresets(next);
          return next;
        });
        return;
      }

      setStore((prev) => {
        const current = prev[resolvedTheme];
        const nextSide: ThemeOverrides = { ...current };
        if (value === null) delete nextSide[token];
        else nextSide[token] = value;
        const next: StoredOverrides = { ...prev, [resolvedTheme]: nextSide };
        saveOverrides(next);
        return next;
      });
    },
    [activePreset, resolvedTheme],
  );

  const resetAll = useCallback(() => {
    if (activePreset?.readOnly) return;

    if (activePreset) {
      const targetId = activePreset.id;
      setPresetState((prev) => {
        const nextPresets = prev.presets.map((p) =>
          p.id === targetId ? { ...p, overrides: {} } : p,
        );
        const next: StoredPresets = { ...prev, presets: nextPresets };
        savePresets(next);
        return next;
      });
      return;
    }

    setStore((prev) => {
      const next: StoredOverrides = { ...prev, [resolvedTheme]: {} };
      saveOverrides(next);
      return next;
    });
  }, [activePreset, resolvedTheme]);

  const selectPreset = useCallback(
    (id: string | null) => {
      setPresetState((prev) => {
        if (id !== null) {
          const ok = prev.presets.some(
            (p) => p.id === id && p.base === resolvedTheme,
          );
          if (!ok) return prev;
        }
        const next: StoredPresets = {
          ...prev,
          active: { ...prev.active, [resolvedTheme]: id },
        };
        savePresets(next);
        return next;
      });
    },
    [resolvedTheme],
  );

  const createPresetFromCurrent = useCallback(
    (name: string): ThemePreset => {
      const newPreset: ThemePreset = {
        id: createPresetId(),
        name,
        base: resolvedTheme,
        overrides: { ...appliedOverrides },
        version: 1,
      };
      setPresetState((prev) => {
        const next: StoredPresets = {
          ...prev,
          presets: [...prev.presets, newPreset],
          active: { ...prev.active, [resolvedTheme]: newPreset.id },
        };
        savePresets(next);
        return next;
      });
      return newPreset;
    },
    [appliedOverrides, resolvedTheme],
  );

  const renamePreset = useCallback((id: string, name: string) => {
    setPresetState((prev) => {
      const target = prev.presets.find((p) => p.id === id);
      if (!target || target.readOnly) return prev;
      const nextPresets = prev.presets.map((p) =>
        p.id === id ? { ...p, name } : p,
      );
      const next: StoredPresets = { ...prev, presets: nextPresets };
      savePresets(next);
      return next;
    });
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresetState((prev) => {
      const target = prev.presets.find((p) => p.id === id);
      if (!target || target.readOnly) return prev;
      const nextPresets = prev.presets.filter((p) => p.id !== id);
      const nextActive = {
        dark: prev.active.dark === id ? null : prev.active.dark,
        light: prev.active.light === id ? null : prev.active.light,
      };
      const next: StoredPresets = {
        ...prev,
        presets: nextPresets,
        active: nextActive,
      };
      savePresets(next);
      return next;
    });
  }, []);

  const exportPreset = useCallback(
    (id: string): string => {
      const target = presetState.presets.find((p) => p.id === id);
      if (!target) return "";
      return serializePresetForExport(target);
    },
    [presetState.presets],
  );

  const importPreset = useCallback((raw: string): ImportResult => {
    const result = parsePresetFromImport(raw);
    if (!result.ok) return result;
    setPresetState((prev) => {
      const next: StoredPresets = {
        ...prev,
        presets: [...prev.presets, result.preset],
      };
      savePresets(next);
      return next;
    });
    return result;
  }, []);

  const presetsForTheme = useMemo(
    () => presetState.presets.filter((p) => p.base === resolvedTheme),
    [presetState.presets, resolvedTheme],
  );

  return {
    overrides: appliedOverrides,
    setToken,
    resetAll,
    presets: presetsForTheme,
    activePresetId,
    selectPreset,
    createPresetFromCurrent,
    renamePreset,
    deletePreset,
    exportPreset,
    importPreset,
  };
}
