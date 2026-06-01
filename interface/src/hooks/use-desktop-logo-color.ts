import { useCallback, useEffect, useSyncExternalStore } from "react";
import { syncPulseKeyframes } from "./logo-pulse-keyframes";

// NOTE: this hook is localStorage-only, matching the existing
// theme-overrides framework (see hooks/use-theme-overrides.ts). The
// logo color + pulse settings live in localStorage and sync across
// tabs via the `storage` event; they do NOT round-trip to the server,
// so they're per-device and reset on a storage clear. Server-backed
// cross-install persistence is intentionally out of scope here and can
// be layered on later as a separate change.
//
// TODO(aura-logo titlebar integration): the wordmark render target,
// DesktopShell/DesktopTitlebar.tsx, was deleted by the AuraShell
// unification refactor. The wordmark now lives in
// components/AuraShell/AuraTitlebar.tsx as a PNG `<img ... data-aura-wordmark>`.
// Re-integration is a design decision (a PNG `<img>` can't be recolored
// via the --desktop-logo-color CSS var the inline-SVG path relied on;
// either swap to the inline SVG in public/AURA_logo_text_mark.svg, or
// apply color via an SVG mask / CSS filter). Until then this feature is
// settable + persisted locally but not yet visually applied.

const STORAGE_KEY = "aura-desktop-preferences";
const LEGACY_COLOR_KEY = "aura-desktop-logo-color";

export type PulseMode = "fade" | "sweep";

interface DesktopPrefsLocal {
  color: string;
  pulseEnabled: boolean;
  pulseMode: PulseMode;
  pulseSpeed: number;
  pulseFromColor: string;
  sweepReversed: boolean;
  pauseDuration: number;
}

const DEFAULTS: DesktopPrefsLocal = {
  color: "",
  pulseEnabled: false,
  pulseMode: "fade",
  pulseSpeed: 2,
  pulseFromColor: "",
  sweepReversed: false,
  pauseDuration: 0,
};

function parseStored(): DesktopPrefsLocal {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    const legacy = localStorage.getItem(LEGACY_COLOR_KEY);
    if (legacy) return { ...DEFAULTS, color: legacy };
  } catch {}
  return DEFAULTS;
}

// Module-level stable reference — useSyncExternalStore requires the same
// object reference to be returned when the data hasn't changed.
let _prefs: DesktopPrefsLocal = parseStored();

function getSnapshot(): DesktopPrefsLocal {
  return _prefs;
}

function writeLocal(next: DesktopPrefsLocal): void {
  _prefs = next;
  syncPulseKeyframes(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      try {
        _prefs = e.newValue ? { ...DEFAULTS, ...JSON.parse(e.newValue) } : DEFAULTS;
      } catch {
        _prefs = DEFAULTS;
      }
      cb();
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", handleStorage);
  };
}

function notify(): void {
  for (const cb of listeners) cb();
}

/** Write-through helper: persist to localStorage, then notify mounted
 *  hook instances so they re-render with the new value. */
function persistStore(next: DesktopPrefsLocal): void {
  writeLocal(next);
  notify();
}

function applyPatch(update: Partial<DesktopPrefsLocal>): void {
  persistStore({ ..._prefs, ...update });
}

// Eagerly initialize the style element on module load so keyframes exist
// before the first render.
if (typeof window !== "undefined") {
  syncPulseKeyframes(_prefs);
}

export function useDesktopLogoColor() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);

  useEffect(() => {
    syncPulseKeyframes(_prefs);
  }, []);

  const setColor = useCallback((next: string | undefined) => {
    applyPatch({ color: next ?? "" });
  }, []);

  const setPulseEnabled = useCallback((next: boolean) => {
    applyPatch({ pulseEnabled: next });
  }, []);

  const setPulseMode = useCallback((next: PulseMode) => {
    applyPatch({ pulseMode: next });
  }, []);

  const setPulseSpeed = useCallback((next: number) => {
    applyPatch({ pulseSpeed: next });
  }, []);

  const setPulseFromColor = useCallback((next: string | undefined) => {
    applyPatch({ pulseFromColor: next ?? "" });
  }, []);

  const setSweepReversed = useCallback((next: boolean) => {
    applyPatch({ sweepReversed: next });
  }, []);

  const setPauseDuration = useCallback((next: number) => {
    applyPatch({ pauseDuration: next });
  }, []);

  return {
    color: prefs.color,
    pulseEnabled: prefs.pulseEnabled,
    pulseMode: prefs.pulseMode,
    pulseSpeed: prefs.pulseSpeed,
    pulseFromColor: prefs.pulseFromColor,
    sweepReversed: prefs.sweepReversed,
    pauseDuration: prefs.pauseDuration,
    setColor,
    setPulseEnabled,
    setPulseMode,
    setPulseSpeed,
    setPulseFromColor,
    setSweepReversed,
    setPauseDuration,
  };
}
