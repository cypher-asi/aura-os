# Interface performance instrumentation

## Startup marks (User Timing)

The client records namespaced [`performance.mark`](https://developer.mozilla.org/en-US/docs/Web/API/Performance/mark) entries with the prefix `aura:`.

| Mark | When |
|------|------|
| `aura:app:entry` | Earliest point in `main.tsx` after perf helpers initialize |
| `aura:app:react:root-render-scheduled` | Immediately after `createRoot(...).render(...)` |
| `aura:auth:session-restore:complete` | Initial `restoreSession()` finished (`auth-store`) |
| `aura:ui:shell:visible` | `AppShell` mounted (main chrome) |
| `aura:data:projects:initial-ready` | First projects list refresh completed while authenticated (once per load) |

Inspect in Chrome DevTools **Performance** → **Timings**, or `performance.getEntriesByType("mark")` in the console.

## `window.__AURA_PERF__`

A small snapshot for debugging and Playwright:

- `marks`: map of mark name → `startTime` (ms, same basis as `performance.now()`).
- `firstProjectsRefreshComplete`: set when `aura:data:projects:initial-ready` fires.
- `webVitals`: last LCP / CLS samples from the lightweight observer (see below).

## Web vitals (lite)

`initWebVitalsLite()` registers `PerformanceObserver`s for LCP and CLS and updates `window.__AURA_PERF__.webVitals`. No npm dependency; not a full [web-vitals](https://github.com/GoogleChrome/web-vitals) implementation.

## Dev-only helpers

In development, `window.auraLogStartupPerf()` logs mark deltas (from `aura:app:entry`) when `localStorage["aura:perf:debug"] === "1"`.

## Bundle analysis

Produce an interactive treemap under `interface/dist/stats.html` (ignored by git with `dist/`):

```bash
cd interface
npm run build:analyze
```

Open `dist/stats.html` in a browser after the build. Uses [`rollup-plugin-visualizer`](https://github.com/btd/rollup-plugin-visualizer) when `--mode analyze` is set.

## Perf guardrails (budgets)

Thresholds live in [`perf/budgets.json`](../perf/budgets.json): startup mark deltas (from `aura:app:entry`), gzip bundle ceilings, and loose login-route web vitals caps. CI is not wired to these by default; run them locally before merging large UI or bundler changes.

| Command | What it does |
|--------|----------------|
| `npm run perf:bundle-budgets` | After `npm run build`, fails if gzip sizes exceed budgets (initial HTML-linked graph, largest JS chunk, total JS). |
| `npm run test:e2e:perf` | Playwright perf project: startup marks + web vitals vs `budgets.json`. |
| `npm run perf:guardrails` | One-shot: `build` → bundle budgets → perf Playwright tests. |

Bundle checks use the same gzip compression Node’s `zlib` applies to each file (aligned with Vite’s “gzip size” reporting, not Brotli).

## Playwright

```bash
cd interface
npm run test:e2e:perf
```

Tests live under `tests/e2e/perf/` and enforce the budgets above against the preview server (marks, deltas, and `window.__AURA_PERF__.webVitals` on `/login`).

The default Playwright config starts `npm run build && npm run preview …`, so TypeScript must pass. To point tests at an already-running preview (for example after `vite build` without `tsc -b`):

```powershell
$env:AURA_EVAL_LIVE="1"
$env:AURA_EVAL_BASE_URL="http://127.0.0.1:4173"
npx playwright test --project=perf-desktop-chromium
```
