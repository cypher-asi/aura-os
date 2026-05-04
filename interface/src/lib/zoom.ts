/**
 * App-level zoom controls used by the View menu (Zoom In / Out / Actual Size).
 *
 * We drive `document.documentElement.style.zoom`, which is supported in
 * Chromium-based browsers including the WebView2 host that ships with the
 * `aura-os-desktop` binary. The level is persisted in `localStorage` and
 * reapplied at module import time so the user's last zoom survives reloads.
 */

const STORAGE_KEY = "aura.zoom.level";
const MIN_LEVEL = 0.5;
const MAX_LEVEL = 2.5;
const STEP = 0.1;
const DEFAULT_LEVEL = 1;

let currentLevel = DEFAULT_LEVEL;

function clampLevel(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return DEFAULT_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, value));
}

function applyLevel(level: number): void {
  currentLevel = clampLevel(level);
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root) return;
  // Chromium honors the non-standard `zoom` CSS property here; WebView2
  // (Edge Chromium) inherits this. CSS `transform: scale()` would create
  // layout shifts and break fixed-position elements, so we deliberately
  // avoid it.
  root.style.zoom = currentLevel === 1 ? "" : String(currentLevel);
}

function readStoredLevel(): number {
  if (typeof window === "undefined") return DEFAULT_LEVEL;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LEVEL;
    const parsed = Number.parseFloat(raw);
    return clampLevel(parsed);
  } catch {
    return DEFAULT_LEVEL;
  }
}

function persistLevel(level: number): void {
  if (typeof window === "undefined") return;
  try {
    if (level === DEFAULT_LEVEL) {
      window.localStorage?.removeItem(STORAGE_KEY);
    } else {
      window.localStorage?.setItem(STORAGE_KEY, String(level));
    }
  } catch {
    // Ignore quota / privacy-mode storage errors — zoom still applies in-memory.
  }
}

export function getZoomLevel(): number {
  return currentLevel;
}

export function zoomIn(): number {
  const next = clampLevel(currentLevel + STEP);
  applyLevel(next);
  persistLevel(next);
  return currentLevel;
}

export function zoomOut(): number {
  const next = clampLevel(currentLevel - STEP);
  applyLevel(next);
  persistLevel(next);
  return currentLevel;
}

export function resetZoom(): number {
  applyLevel(DEFAULT_LEVEL);
  persistLevel(DEFAULT_LEVEL);
  return currentLevel;
}

/**
 * Restore the persisted zoom on app boot. Safe to call multiple times — only
 * the last invocation's value sticks.
 */
export function initZoom(): void {
  const stored = readStoredLevel();
  applyLevel(stored);
}

if (typeof window !== "undefined") {
  initZoom();
}
