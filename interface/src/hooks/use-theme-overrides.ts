import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@cypher-asi/zui";
import {
  applyOverridesToDocument,
  loadOverrides,
  saveOverrides,
  type EditableToken,
  type StoredOverrides,
  type ThemeOverrides,
} from "../lib/theme-overrides";

export type UseThemeOverridesResult = {
  /** Active override map for the current `resolvedTheme`. */
  overrides: ThemeOverrides;
  /** Set or clear (null) a single token for the current `resolvedTheme`. */
  setToken: (token: EditableToken, value: string | null) => void;
  /** Clear every override for the current `resolvedTheme`. */
  resetAll: () => void;
};

function emptyStore(): StoredOverrides {
  return { dark: {}, light: {} };
}

/**
 * Lazy initializer for `useState`: hydrate from `localStorage` once on
 * first render so we don't thrash storage reads, and avoid the "undefined
 * on first paint" flash that would occur if we loaded inside a `useEffect`.
 */
function initialStore(): StoredOverrides {
  if (typeof window === "undefined") return emptyStore();
  return loadOverrides();
}

export function useThemeOverrides(): UseThemeOverridesResult {
  const { resolvedTheme } = useTheme();
  const [store, setStore] = useState<StoredOverrides>(initialStore);

  useEffect(() => {
    applyOverridesToDocument(resolvedTheme, store[resolvedTheme]);
  }, [resolvedTheme, store]);

  const setToken = useCallback(
    (token: EditableToken, value: string | null) => {
      setStore((prev) => {
        const current = prev[resolvedTheme];
        const nextSide: ThemeOverrides = { ...current };
        if (value === null) {
          delete nextSide[token];
        } else {
          nextSide[token] = value;
        }
        const next: StoredOverrides = { ...prev, [resolvedTheme]: nextSide };
        saveOverrides(next);
        applyOverridesToDocument(resolvedTheme, nextSide);
        return next;
      });
    },
    [resolvedTheme],
  );

  const resetAll = useCallback(() => {
    setStore((prev) => {
      const next: StoredOverrides = { ...prev, [resolvedTheme]: {} };
      saveOverrides(next);
      applyOverridesToDocument(resolvedTheme, {});
      return next;
    });
  }, [resolvedTheme]);

  return {
    overrides: store[resolvedTheme],
    setToken,
    resetAll,
  };
}
