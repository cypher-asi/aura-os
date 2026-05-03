import type { ResolvedTheme } from "@cypher-asi/zui";

/**
 * Ordered list of CSS custom properties users can override from the
 * Settings > Appearance editor (phase 7). The accent token is included
 * alongside the chrome tokens so power users can dial in an off-palette
 * accent without waiting for phase 8's named presets. All of these are
 * applied as inline `document.documentElement.style` rules, which beat
 * anything declared on `:root` / `[data-theme='...']` by specificity.
 */
export const EDITABLE_TOKENS = [
  "--color-border",
  "--color-surface-tint",
  "--color-elevated-tint",
  "--color-sidebar-bg",
  "--color-sidekick-bg",
  "--color-titlebar-bg",
  "--color-accent",
] as const;

export type EditableToken = (typeof EDITABLE_TOKENS)[number];

/** Per-token override values. Missing keys mean "use default". */
export type ThemeOverrides = Partial<Record<EditableToken, string>>;

/** Stored shape: independent overrides for dark vs light. */
export type StoredOverrides = {
  dark: ThemeOverrides;
  light: ThemeOverrides;
};

const STORAGE_KEY = "aura-theme-overrides";

const EDITABLE_TOKEN_SET: ReadonlySet<string> = new Set(EDITABLE_TOKENS);

function emptyStore(): StoredOverrides {
  return { dark: {}, light: {} };
}

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

export function loadOverrides(): StoredOverrides {
  if (typeof window === "undefined") return emptyStore();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyStore();
    return {
      dark: sanitizeOverrides(parsed.dark),
      light: sanitizeOverrides(parsed.light),
    };
  } catch {
    return emptyStore();
  }
}

export function saveOverrides(next: StoredOverrides): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded / privacy-mode storage: silently ignore so the UI
    // stays responsive. The in-memory hook state remains the source of
    // truth for the current session.
  }
}

/**
 * Writes the given override map onto `document.documentElement.style`,
 * setting properties that are present and REMOVING properties that are
 * absent so switching resolved themes (or resetting) doesn't leak values
 * from the previous set.
 *
 * The `resolved` argument is currently unused at the CSS level (the
 * overrides win via specificity regardless of `data-theme`) but is kept
 * in the signature so future versions can namespace storage or animate
 * transitions without a breaking API change.
 */
export function applyOverridesToDocument(
  _resolved: ResolvedTheme,
  overrides: ThemeOverrides,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const token of EDITABLE_TOKENS) {
    const value = overrides[token];
    if (typeof value === "string" && value.length > 0) {
      root.style.setProperty(token, value);
    } else {
      root.style.removeProperty(token);
    }
  }
}

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[-0-9.%,\s/]+\s*\)$/i;
const NAMED_RE = /^[a-z]+$/i;

/**
 * Lightweight CSS color validator. Accepts `#rgb` / `#rgba` /
 * `#rrggbb` / `#rrggbbaa`, functional `rgb()` / `rgba()` / `hsl()` /
 * `hsla()` notation, and named colors. This is intentionally not
 * exhaustive — it exists to reject obvious garbage before we write to
 * `element.style` (where the browser would silently drop it anyway).
 */
export function isValidColorValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (HEX_RE.test(trimmed)) return true;
  if (FUNC_RE.test(trimmed)) return true;
  if (NAMED_RE.test(trimmed)) return true;
  return false;
}
