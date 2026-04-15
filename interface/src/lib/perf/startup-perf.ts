/**
 * Client startup timing: User Timing marks + a small window snapshot for
 * DevTools, Playwright, and manual debugging. Safe to call from any layer.
 */

const MARK_PREFIX = "aura:";

export type AuraPerfSnapshot = {
  /** Mark name → startTime (ms since navigation/time origin, same basis as performance.now()). */
  marks: Record<string, number>;
  /** Set once when the first projects list refresh completes (authenticated flows). */
  firstProjectsRefreshComplete: boolean;
};

declare global {
  interface Window {
    /** Populated in the browser for debugging and e2e (see docs/perf-instrumentation.md). */
    __AURA_PERF__?: AuraPerfSnapshot & {
      webVitals?: import("./web-vitals-lite").AuraWebVitalsSnapshot;
    };
  }
}

let firstProjectsRefreshMarked = false;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof performance !== "undefined" && typeof performance.mark === "function";
}

function safeMark(name: string): void {
  if (!isBrowser()) return;
  const full = name.startsWith(MARK_PREFIX) ? name : `${MARK_PREFIX}${name}`;
  try {
    performance.mark(full);
  } catch {
    // Duplicate mark name in some browsers — ignore.
  }
  exposeSnapshot();
}

function exposeSnapshot(): void {
  if (!isBrowser()) return;
  const marks: Record<string, number> = {};
  for (const entry of performance.getEntriesByType("mark") as PerformanceMark[]) {
    if (entry.name.startsWith(MARK_PREFIX)) {
      marks[entry.name] = entry.startTime;
    }
  }
  const prev = window.__AURA_PERF__;
  window.__AURA_PERF__ = {
    marks,
    firstProjectsRefreshComplete: firstProjectsRefreshMarked,
    webVitals: prev?.webVitals,
  };
}

/** First line of app entry (after modules load). Call from main.tsx as early as possible. */
export function markAppEntry(): void {
  safeMark("app:entry");
}

/** Immediately after root.render() is invoked. */
export function markReactRootRenderScheduled(): void {
  safeMark("app:react:root-render-scheduled");
}

/** Main chrome is mounted (DesktopShell or MobileShell under AppShell). */
export function markShellVisible(): void {
  safeMark("ui:shell:visible");
}

/** Session restore attempt finished (success, 401, or network error path). */
export function markAuthRestoreComplete(): void {
  safeMark("auth:session-restore:complete");
}

/** First completed projects list refresh after login (once per page load). */
export function markFirstProjectsDataReady(): void {
  if (firstProjectsRefreshMarked) return;
  firstProjectsRefreshMarked = true;
  safeMark("data:projects:initial-ready");
}

export function getAuraPerfSnapshot(): AuraPerfSnapshot {
  const marks: Record<string, number> = {};
  if (isBrowser()) {
    for (const entry of performance.getEntriesByType("mark") as PerformanceMark[]) {
      if (entry.name.startsWith(MARK_PREFIX)) {
        marks[entry.name] = entry.startTime;
      }
    }
  }
  return {
    marks,
    firstProjectsRefreshComplete: firstProjectsRefreshMarked,
  };
}

/** Optional: log mark deltas in dev when `localStorage["aura:perf:debug"] === "1"`. */
export function maybeLogStartupPerf(): void {
  if (!isBrowser() || !import.meta.env.DEV) return;
  try {
    if (localStorage.getItem("aura:perf:debug") !== "1") return;
  } catch {
    return;
  }
  const snap = getAuraPerfSnapshot();
  const m = snap.marks;
  const t0 = m["aura:app:entry"];
  if (t0 === undefined) return;
  const row: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) {
    row[k] = `${(v - t0).toFixed(1)} ms (Δ entry)`;
  }
  console.info("[aura:perf] startup marks (delta from aura:app:entry)", row);
}

/** Dev-only: `window.auraLogStartupPerf()` to print mark deltas. */
export function installDevPerfHelpers(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  (window as unknown as { auraLogStartupPerf?: () => void }).auraLogStartupPerf = maybeLogStartupPerf;
}
