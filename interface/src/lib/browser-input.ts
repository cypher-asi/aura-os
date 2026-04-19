/**
 * DOM → CDP input adapters for the remote browser viewport.
 *
 * The backend speaks CDP and expects:
 *   - modifier masks as bitwise OR of Alt=1, Ctrl=2, Meta=4, Shift=8
 *   - mouse buttons as a small enum
 *   - key events with `windowsVirtualKeyCode` for non-printable keys
 *
 * This module centralises the translation so the viewport component stays
 * dumb and only wires handlers.
 */

import type {
  BrowserClientMsg,
  MouseButton,
  MouseEventKind,
} from "../api/browser";

/** Bitmask bits that CDP's `Input.dispatchKeyEvent.modifiers` expects. */
export const CDP_MOD_ALT = 1;
export const CDP_MOD_CTRL = 2;
export const CDP_MOD_META = 4;
export const CDP_MOD_SHIFT = 8;

/** Extract the CDP modifier bitmask from a DOM keyboard/mouse event. */
export function cdpModifierMask(
  event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
): number {
  let mod = 0;
  if (event.altKey) mod |= CDP_MOD_ALT;
  if (event.ctrlKey) mod |= CDP_MOD_CTRL;
  if (event.metaKey) mod |= CDP_MOD_META;
  if (event.shiftKey) mod |= CDP_MOD_SHIFT;
  return mod;
}

/** Map a `MouseEvent.button` numeric id to our wire enum. */
export function cdpMouseButton(domButton: number): MouseButton {
  switch (domButton) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return "none";
  }
}

export interface ViewportRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ViewportCoords {
  readonly x: number;
  readonly y: number;
}

/**
 * Convert a DOM MouseEvent / WheelEvent into viewport CSS pixels, clamped
 * to the viewport box. Coordinates outside the box are clipped so the
 * backend never sees negative or out-of-bounds values.
 */
export function toViewportCoords(
  event: { clientX: number; clientY: number },
  rect: ViewportRect,
): ViewportCoords {
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  return { x, y };
}

/**
 * Build a mouse ClientMsg. The `kind` disambiguates move/down/up; for
 * moves the button should be `none` unless a button is currently held.
 */
export function buildMouseMsg(
  kind: MouseEventKind,
  coords: ViewportCoords,
  opts: { button?: MouseButton; modifiers?: number; clickCount?: number } = {},
): BrowserClientMsg {
  return {
    type: "mouse",
    event: kind,
    x: coords.x,
    y: coords.y,
    button: opts.button,
    modifiers: opts.modifiers ?? 0,
    click_count: opts.clickCount ?? 0,
  };
}

export function buildWheelMsg(
  coords: ViewportCoords,
  deltaX: number,
  deltaY: number,
): BrowserClientMsg {
  return {
    type: "wheel",
    x: coords.x,
    y: coords.y,
    delta_x: deltaX,
    delta_y: deltaY,
  };
}

// ---------------------------------------------------------------------------
// Keyboard ↔ CDP translation.
// ---------------------------------------------------------------------------

/**
 * Mapping from DOM `KeyboardEvent.code` values to the Windows virtual-key
 * code CDP expects for the same key. Covers the non-printable surface
 * plus the digits and letters that have a well-known 1:1 mapping on a
 * standard US layout. Printable characters that aren't in this table
 * still dispatch correctly because we include `text`; this map is used
 * only so in-page handlers that inspect `event.keyCode` receive the
 * expected value.
 */
const vkByCode: Record<string, number> = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  ShiftLeft: 0x10,
  ShiftRight: 0x10,
  ControlLeft: 0x11,
  ControlRight: 0x11,
  AltLeft: 0x12,
  AltRight: 0x12,
  Pause: 0x13,
  CapsLock: 0x14,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  MetaLeft: 0x5b,
  MetaRight: 0x5c,
  ContextMenu: 0x5d,
  Numpad0: 0x60,
  Numpad1: 0x61,
  Numpad2: 0x62,
  Numpad3: 0x63,
  Numpad4: 0x64,
  Numpad5: 0x65,
  Numpad6: 0x66,
  Numpad7: 0x67,
  Numpad8: 0x68,
  Numpad9: 0x69,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDecimal: 0x6e,
  NumpadDivide: 0x6f,
  NumpadEnter: 0x0d,
  F1: 0x70,
  F2: 0x71,
  F3: 0x72,
  F4: 0x73,
  F5: 0x74,
  F6: 0x75,
  F7: 0x76,
  F8: 0x77,
  F9: 0x78,
  F10: 0x79,
  F11: 0x7a,
  F12: 0x7b,
  NumLock: 0x90,
  ScrollLock: 0x91,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
};

for (let i = 0; i < 10; i++) {
  vkByCode[`Digit${i}`] = 0x30 + i;
}
for (let i = 0; i < 26; i++) {
  vkByCode[`Key${String.fromCharCode(0x41 + i)}`] = 0x41 + i;
}

export const VK_BY_CODE: Readonly<Record<string, number>> = Object.freeze(vkByCode);

/** `true` when the key typed a printable character. */
export function isPrintableKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1;
}

/**
 * Browser keyboard events that should never be forwarded to the remote
 * page because they would hijack the host app's own shortcuts (tab
 * switching, reload the app, DevTools, etc.). Keep this list small.
 */
export const BLOCKED_KEY_COMBOS: ReadonlyArray<
  (event: KeyboardEvent) => boolean
> = [
  (e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r",
  (e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t",
  (e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w",
  (e) => e.key === "F5",
];
