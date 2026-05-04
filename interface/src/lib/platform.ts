/**
 * Platform detection + cross-platform keyboard shortcut helpers.
 *
 * We render shortcut hints next to menu items (File / Edit / View / Help)
 * using glyphs that match each OS's native conventions:
 *   - macOS:    ⌘ (Cmd) ⇧ (Shift) ⌥ (Option) ⌃ (Control)
 *   - Win/Linux: "Ctrl+", "Shift+", "Alt+"
 *
 * The same `ShortcutSpec` is used for both display (`formatShortcut`) and
 * matching (`matchesShortcut`), so the menu hint and the global hotkey
 * dispatcher cannot drift out of sync.
 *
 * `mod` resolves to Cmd on macOS and Ctrl on every other platform, mirroring
 * what users type today in chat / IDE / VS Code conventions.
 */

export interface ShortcutSpec {
  /** Single key, matched against `KeyboardEvent.key` (case-insensitive). */
  key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Ctrl key explicitly (rare; for shortcuts that must use Ctrl on macOS too). */
  ctrl?: boolean;
}

let cachedIsMac: boolean | null = null;

export function isMac(): boolean {
  if (cachedIsMac !== null) return cachedIsMac;
  if (typeof navigator === "undefined") {
    cachedIsMac = false;
    return cachedIsMac;
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ?? navigator.platform ?? "";
  cachedIsMac = /mac/i.test(platform);
  return cachedIsMac;
}

/** Test-only escape hatch so unit tests can flip the platform without touching globals. */
export function __setIsMacForTesting(value: boolean | null): void {
  cachedIsMac = value;
}

const MAC_GLYPHS = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  ctrl: "⌃",
} as const;

function formatKey(key: string, mac: boolean): string {
  const lower = key.toLowerCase();
  switch (lower) {
    case "arrowleft":
      return mac ? "←" : "Left";
    case "arrowright":
      return mac ? "→" : "Right";
    case "arrowup":
      return mac ? "↑" : "Up";
    case "arrowdown":
      return mac ? "↓" : "Down";
    case " ":
    case "space":
      return "Space";
    case "escape":
    case "esc":
      return "Esc";
    case ",":
      return ",";
    case ".":
      return ".";
    case "delete":
      return "Delete";
    case "backspace":
      return mac ? "⌫" : "Backspace";
    case "enter":
    case "return":
      return mac ? "↵" : "Enter";
    case "tab":
      return "Tab";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

export function formatShortcut(spec: ShortcutSpec): string {
  const mac = isMac();
  const keyLabel = formatKey(spec.key, mac);
  if (mac) {
    let prefix = "";
    if (spec.ctrl) prefix += MAC_GLYPHS.ctrl;
    if (spec.alt) prefix += MAC_GLYPHS.alt;
    if (spec.shift) prefix += MAC_GLYPHS.shift;
    if (spec.mod) prefix += MAC_GLYPHS.mod;
    return `${prefix}${keyLabel}`;
  }
  const parts: string[] = [];
  if (spec.mod || spec.ctrl) parts.push("Ctrl");
  if (spec.alt) parts.push("Alt");
  if (spec.shift) parts.push("Shift");
  parts.push(keyLabel);
  return parts.join("+");
}

export function matchesShortcut(event: KeyboardEvent, spec: ShortcutSpec): boolean {
  const mac = isMac();
  const wantsMod = Boolean(spec.mod);
  const wantsCtrlOnly = Boolean(spec.ctrl);
  const modActive = mac ? event.metaKey : event.ctrlKey;
  if (wantsMod && !modActive) return false;
  if (!wantsMod && !wantsCtrlOnly && (event.metaKey || event.ctrlKey)) return false;
  if (wantsCtrlOnly && !event.ctrlKey) return false;
  if (Boolean(spec.shift) !== event.shiftKey) return false;
  if (Boolean(spec.alt) !== event.altKey) return false;
  return event.key.toLowerCase() === spec.key.toLowerCase();
}
