/**
 * xterm.js theme builder. Reads `--color-terminal-*` and
 * `--color-terminal-ansi-*` design tokens from `:root` so the embedded
 * terminal always reflects the active theme. The `resolved` argument is
 * accepted (and recorded in the fallback selection) so callers can
 * deterministically pick fallback values when a token is missing — for
 * example in unit tests or during the brief boot window before tokens.css
 * has been parsed.
 */

export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionInactiveBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export type ResolvedTheme = "dark" | "light";

interface PaletteFallbacks {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionInactiveBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const DARK_FALLBACK: PaletteFallbacks = {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#aeafad",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#264f78",
  selectionInactiveBackground: "rgba(38, 79, 120, 0.7)",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#e5e5e5",
};

const LIGHT_FALLBACK: PaletteFallbacks = {
  background: "#ffffff",
  foreground: "#1f2937",
  cursor: "#374151",
  cursorAccent: "#ffffff",
  selectionBackground: "#bfdbfe",
  selectionInactiveBackground: "rgba(191, 219, 254, 0.7)",
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

export function getXtermTheme(resolved: ResolvedTheme): XtermTheme {
  const fallbacks = resolved === "light" ? LIGHT_FALLBACK : DARK_FALLBACK;
  const styles = typeof document === "undefined"
    ? null
    : getComputedStyle(document.documentElement);

  if (!styles) return { ...fallbacks };

  return {
    background: readVar(styles, "--color-terminal-bg", fallbacks.background),
    foreground: readVar(styles, "--color-terminal-fg", fallbacks.foreground),
    cursor: readVar(styles, "--color-terminal-cursor", fallbacks.cursor),
    cursorAccent: readVar(styles, "--color-terminal-cursor-accent", fallbacks.cursorAccent),
    selectionBackground: readVar(styles, "--color-terminal-selection-bg", fallbacks.selectionBackground),
    selectionInactiveBackground: readVar(
      styles,
      "--color-terminal-selection-inactive-bg",
      fallbacks.selectionInactiveBackground,
    ),
    black: readVar(styles, "--color-terminal-ansi-black", fallbacks.black),
    red: readVar(styles, "--color-terminal-ansi-red", fallbacks.red),
    green: readVar(styles, "--color-terminal-ansi-green", fallbacks.green),
    yellow: readVar(styles, "--color-terminal-ansi-yellow", fallbacks.yellow),
    blue: readVar(styles, "--color-terminal-ansi-blue", fallbacks.blue),
    magenta: readVar(styles, "--color-terminal-ansi-magenta", fallbacks.magenta),
    cyan: readVar(styles, "--color-terminal-ansi-cyan", fallbacks.cyan),
    white: readVar(styles, "--color-terminal-ansi-white", fallbacks.white),
    brightBlack: readVar(styles, "--color-terminal-ansi-bright-black", fallbacks.brightBlack),
    brightRed: readVar(styles, "--color-terminal-ansi-bright-red", fallbacks.brightRed),
    brightGreen: readVar(styles, "--color-terminal-ansi-bright-green", fallbacks.brightGreen),
    brightYellow: readVar(styles, "--color-terminal-ansi-bright-yellow", fallbacks.brightYellow),
    brightBlue: readVar(styles, "--color-terminal-ansi-bright-blue", fallbacks.brightBlue),
    brightMagenta: readVar(styles, "--color-terminal-ansi-bright-magenta", fallbacks.brightMagenta),
    brightCyan: readVar(styles, "--color-terminal-ansi-bright-cyan", fallbacks.brightCyan),
    brightWhite: readVar(styles, "--color-terminal-ansi-bright-white", fallbacks.brightWhite),
  };
}
