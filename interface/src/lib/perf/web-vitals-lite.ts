/**
 * Lightweight Core Web Vitals–style sampling without extra dependencies.
 * Values are exposed on window.__AURA_PERF__.webVitals for DevTools / e2e.
 */

export type AuraWebVitalsSnapshot = {
  lcpMs: number | null;
  cls: number;
  lastLayoutShiftSession?: { value: number; hadRecentInput: boolean };
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof performance !== "undefined";
}

function mergeIntoWindow(snapshot: Partial<AuraWebVitalsSnapshot>): void {
  if (!isBrowser()) return;
  const prev = window.__AURA_PERF__ ?? { marks: {}, firstProjectsRefreshComplete: false };
  window.__AURA_PERF__ = {
    ...prev,
    webVitals: {
      lcpMs: snapshot.lcpMs ?? prev.webVitals?.lcpMs ?? null,
      cls: snapshot.cls ?? prev.webVitals?.cls ?? 0,
      lastLayoutShiftSession: snapshot.lastLayoutShiftSession ?? prev.webVitals?.lastLayoutShiftSession,
    },
  };
}

/**
 * Register PerformanceObservers for LCP and CLS. Idempotent per page load.
 */
export function initWebVitalsLite(): void {
  if (!isBrowser()) return;

  let lcpMs: number | null = null;
  let cls = 0;

  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries() as PerformanceEntry[];
      const last = entries[entries.length - 1] as PerformanceEntry & { startTime?: number };
      if (last && typeof last.startTime === "number") {
        lcpMs = last.startTime;
        mergeIntoWindow({ lcpMs });
      }
    });
    lcpObserver.observe({ type: "largest-contentful-paint", buffered: true } as PerformanceObserverInit);
  } catch {
    // Unsupported
  }

  try {
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        const ls = entry as PerformanceEntry & {
          value?: number;
          hadRecentInput?: boolean;
        };
        if (ls.hadRecentInput) continue;
        const v = ls.value ?? 0;
        cls += v;
        mergeIntoWindow({
          cls,
          lastLayoutShiftSession: { value: v, hadRecentInput: Boolean(ls.hadRecentInput) },
        });
      }
    });
    clsObserver.observe({ type: "layout-shift", buffered: true } as PerformanceObserverInit);
  } catch {
    // Unsupported
  }

  mergeIntoWindow({ lcpMs, cls });
}
