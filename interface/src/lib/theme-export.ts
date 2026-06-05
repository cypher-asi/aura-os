import type { ResolvedTheme } from "@cypher-asi/zui";
import {
  EDITABLE_TOKENS,
  type EditableToken,
  type ThemeOverrides,
} from "./theme-overrides";

/**
 * Canonical, self-describing theme document. Unlike the sparse preset export
 * (which only carries changed `overrides`), this format lists EVERY editable
 * token with its resolved value so the JSON is a complete, shareable theme.
 *
 * Identified by `format: "aura-theme"` + `version: 1` so importers can tell it
 * apart from the legacy `{ base, overrides }` preset payload.
 */
export type ThemeDocument = {
  format: "aura-theme";
  version: 1;
  name: string;
  mode: ResolvedTheme;
  tokens: Record<EditableToken, string>;
};

const EDITABLE_TOKEN_SET: ReadonlySet<string> = new Set(EDITABLE_TOKENS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return value === "dark" || value === "light";
}

/**
 * Read the effective value for every editable token from the live document,
 * capturing both `tokens.css` defaults and any inline overrides applied by
 * {@link applyOverridesToDocument}. Returns an empty map when there is no DOM
 * (SSR / jsdom without layout).
 */
export function readResolvedTokens(): Partial<Record<EditableToken, string>> {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return {};
  }
  const styles = window.getComputedStyle(document.documentElement);
  const out: Partial<Record<EditableToken, string>> = {};
  for (const token of EDITABLE_TOKENS) {
    const value = styles.getPropertyValue(token).trim();
    if (value.length > 0) out[token] = value;
  }
  return out;
}

/**
 * Pretty-print a full theme document. Only known editable tokens are emitted,
 * in {@link EDITABLE_TOKENS} order, so the output is stable across machines.
 */
export function serializeThemeDocument(
  name: string,
  mode: ResolvedTheme,
  tokens: Partial<Record<EditableToken, string>>,
): string {
  const ordered: Record<string, string> = {};
  for (const token of EDITABLE_TOKENS) {
    const value = tokens[token];
    if (typeof value === "string" && value.length > 0) ordered[token] = value;
  }
  const doc: ThemeDocument = {
    format: "aura-theme",
    version: 1,
    name,
    mode,
    tokens: ordered as Record<EditableToken, string>,
  };
  return JSON.stringify(doc, null, 2);
}

export type ParsedThemeDocument = {
  name: string;
  mode: ResolvedTheme;
  tokens: ThemeOverrides;
};

/**
 * Parse + validate an {@link ThemeDocument}. Sanitizes `tokens` down to known
 * editable tokens with string values. Returns null when the payload is not a
 * full theme document (callers can then try the legacy preset format).
 */
export function parseThemeDocument(parsed: unknown): ParsedThemeDocument | null {
  if (!isRecord(parsed)) return null;
  if (parsed.format !== "aura-theme") return null;
  if (typeof parsed.name !== "string" || parsed.name.trim().length === 0) {
    return null;
  }
  if (!isResolvedTheme(parsed.mode)) return null;
  if (!isRecord(parsed.tokens)) return null;
  const tokens: ThemeOverrides = {};
  for (const [key, value] of Object.entries(parsed.tokens)) {
    if (typeof value !== "string") continue;
    if (!EDITABLE_TOKEN_SET.has(key)) continue;
    tokens[key as EditableToken] = value;
  }
  return { name: parsed.name.trim(), mode: parsed.mode, tokens };
}
