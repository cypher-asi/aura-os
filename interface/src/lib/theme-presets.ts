import type { ResolvedTheme } from "@cypher-asi/zui";
import {
  EDITABLE_TOKENS,
  type EditableToken,
  type ThemeOverrides,
} from "./theme-overrides";

/**
 * A named theme preset. Built-ins have stable ids (`aura-dark`, `aura-light`)
 * and `readOnly: true`. User-created presets get a UUID-ish id from
 * {@link createPresetId} and are mutable.
 *
 * A preset always targets a single resolved theme (`dark` OR `light`) so the
 * UI can filter the picker to entries that actually apply to the current
 * `resolvedTheme`.
 */
export type ThemePreset = {
  id: string;
  name: string;
  base: ResolvedTheme;
  overrides: ThemeOverrides;
  readOnly?: boolean;
  version: 1;
};

/** Persisted preset state. The `active` map is per resolved theme. */
export type StoredPresets = {
  presets: ThemePreset[];
  active: { dark: string | null; light: string | null };
  version: 1;
};

const STORAGE_KEY = "aura-theme-presets";

export const BUILT_IN_DARK_ID = "aura-dark";
export const BUILT_IN_LIGHT_ID = "aura-light";

/**
 * Built-in presets are auto-injected on every load so users can't permanently
 * delete them by clearing storage manually or via a stale serialized blob.
 * Their `overrides` are intentionally empty: the `tokens.css` defaults ARE
 * the preset.
 */
export const BUILT_IN_PRESETS: readonly ThemePreset[] = [
  {
    id: BUILT_IN_DARK_ID,
    name: "Aura Dark",
    base: "dark",
    overrides: {},
    readOnly: true,
    version: 1,
  },
  {
    id: BUILT_IN_LIGHT_ID,
    name: "Aura Light",
    base: "light",
    overrides: {},
    readOnly: true,
    version: 1,
  },
];

const EDITABLE_TOKEN_SET: ReadonlySet<string> = new Set(EDITABLE_TOKENS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeOverrides(raw: unknown): ThemeOverrides {
  if (!isRecord(raw)) return {};
  const out: ThemeOverrides = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    if (!EDITABLE_TOKEN_SET.has(key)) continue;
    out[key as EditableToken] = value;
  }
  return out;
}

function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return value === "dark" || value === "light";
}

function emptyState(): StoredPresets {
  return {
    presets: [...BUILT_IN_PRESETS],
    active: { dark: null, light: null },
    version: 1,
  };
}

function sanitizePreset(raw: unknown): ThemePreset | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  if (!isResolvedTheme(raw.base)) return null;
  const overrides = sanitizeOverrides(raw.overrides);
  const preset: ThemePreset = {
    id: raw.id,
    name: raw.name,
    base: raw.base,
    overrides,
    version: 1,
  };
  if (raw.readOnly === true) preset.readOnly = true;
  return preset;
}

function ensureBuiltIns(presets: ThemePreset[]): ThemePreset[] {
  const out = [...presets];
  for (const builtIn of BUILT_IN_PRESETS) {
    const idx = out.findIndex((p) => p.id === builtIn.id);
    if (idx === -1) {
      out.unshift({ ...builtIn });
    } else {
      // Force built-in identity even if the persisted blob tampered with it.
      out[idx] = { ...builtIn };
    }
  }
  return out;
}

function sanitizeActive(
  raw: unknown,
  presets: ThemePreset[],
): { dark: string | null; light: string | null } {
  const next: { dark: string | null; light: string | null } = {
    dark: null,
    light: null,
  };
  if (!isRecord(raw)) return next;
  for (const key of ["dark", "light"] as const) {
    const value = raw[key];
    if (typeof value !== "string") continue;
    const match = presets.find((p) => p.id === value && p.base === key);
    if (match) next[key] = value;
  }
  return next;
}

export function loadPresets(): StoredPresets {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyState();
    const rawPresets = Array.isArray(parsed.presets) ? parsed.presets : [];
    const sanitized: ThemePreset[] = [];
    for (const entry of rawPresets) {
      const preset = sanitizePreset(entry);
      if (preset) sanitized.push(preset);
    }
    const presets = ensureBuiltIns(sanitized);
    const active = sanitizeActive(parsed.active, presets);
    return { presets, active, version: 1 };
  } catch {
    return emptyState();
  }
}

export function savePresets(next: StoredPresets): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / privacy mode: silently ignore so the UI stays responsive.
  }
}

export function getPresetForResolvedTheme(
  presets: StoredPresets,
  resolved: ResolvedTheme,
): ThemePreset | null {
  const id = presets.active[resolved];
  if (id === null) return null;
  return (
    presets.presets.find((p) => p.id === id && p.base === resolved) ?? null
  );
}

/**
 * Pretty-print a preset for export. Drops the `readOnly` flag so that a
 * shared built-in becomes a normal editable preset on the receiving side.
 */
export function serializePresetForExport(preset: ThemePreset): string {
  const exported: Omit<ThemePreset, "readOnly"> = {
    id: preset.id,
    name: preset.name,
    base: preset.base,
    overrides: preset.overrides,
    version: preset.version,
  };
  return JSON.stringify(exported, null, 2);
}

/**
 * Best-effort UUID generator. Falls back to `Math.random` + timestamp in
 * environments lacking `crypto.randomUUID` (e.g. older test runners).
 */
export function createPresetId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export type ImportResult =
  | { ok: true; preset: ThemePreset }
  | { ok: false; reason: string };

/**
 * Parse + validate a JSON string produced by {@link serializePresetForExport}
 * (or any compatible payload). Always assigns a fresh id so re-importing the
 * same JSON produces a new preset rather than colliding with an existing one.
 */
export function parsePresetFromImport(raw: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "Invalid JSON." };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: "Expected a JSON object." };
  }
  if (typeof parsed.name !== "string" || parsed.name.trim().length === 0) {
    return { ok: false, reason: "Preset is missing a name." };
  }
  if (!isResolvedTheme(parsed.base)) {
    return { ok: false, reason: "Preset 'base' must be 'dark' or 'light'." };
  }
  if (!isRecord(parsed.overrides)) {
    return { ok: false, reason: "Preset 'overrides' must be an object." };
  }
  const overrides = sanitizeOverrides(parsed.overrides);
  const preset: ThemePreset = {
    id: createPresetId(),
    name: parsed.name.trim(),
    base: parsed.base,
    overrides,
    version: 1,
  };
  return { ok: true, preset };
}
