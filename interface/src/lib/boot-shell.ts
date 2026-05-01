import type { AuraApp } from "../apps/types";
import { apps } from "../apps/registry";
import { getLastApp } from "../utils/storage";
import { getInitialShellPath } from "../utils/last-app-path";
import { reportBootError } from "./boot-diagnostics";

/**
 * Default maximum time we'll hold back the desktop window reveal waiting for the
 * initial shell app's lazy module. If the preload hasn't resolved by then we let
 * the window reveal anyway — a slightly-empty shell is strictly better than a
 * visibly stalled boot. Chosen to comfortably cover cached-module resolution on
 * a cold start while staying well under any perceptible "why isn't the app
 * opening?" threshold.
 */
export const DEFAULT_INITIAL_APP_READY_TIMEOUT_MS = 400;

let initialAppReadyPromise: Promise<void> | null = null;

function findAppForPath(path: string, appList: readonly AuraApp[]): AuraApp | undefined {
  const pathname = path.split(/[?#]/, 1)[0] ?? path;
  return appList.find((app) => {
    if (pathname === app.basePath) return true;
    return pathname.startsWith(`${app.basePath}/`);
  });
}

function resolveInitialApp(appList: readonly AuraApp[]): AuraApp | undefined {
  const initialPath = getInitialShellPath(getLastApp(), null);
  return findAppForPath(initialPath, appList);
}

interface PreloadOptions {
  /** Injection point for tests. Defaults to the production `apps` registry. */
  appList?: readonly AuraApp[];
  /** Overrides the wall-clock deadline (ms). `0` disables the safety timeout. */
  timeoutMs?: number;
}

/**
 * Kicks off the lazy-import of the app the shell will render first (last-used app,
 * or the default when none is remembered) and returns a Promise that resolves when
 * that module is in hand — or after the safety timeout, whichever comes first.
 *
 * Call this exactly once at `App.tsx` module load, BEFORE React commits its first
 * render, so that by the time React's Suspense boundary tries to render the initial
 * route the module is already available and no `fallback={null}` empty frame is
 * committed. The desktop layer then gates `signalDesktopReady()` on this same
 * Promise (via `awaitInitialShellAppReady()`), so the first visible frame already
 * contains route content — no "shell chrome, then content fills in" blink.
 *
 * Subsequent calls are idempotent; the first call wins.
 */
export function preloadInitialShellApp(options: PreloadOptions = {}): Promise<void> {
  if (initialAppReadyPromise) {
    return initialAppReadyPromise;
  }

  const { appList = apps, timeoutMs = DEFAULT_INITIAL_APP_READY_TIMEOUT_MS } = options;

  const app = resolveInitialApp(appList);
  if (!app?.preload) {
    initialAppReadyPromise = Promise.resolve();
    return initialAppReadyPromise;
  }

  const preloadResult = app.preload();
  const preloadDone = Promise.resolve(preloadResult)
    .then(() => undefined)
    .catch((error) => {
      reportBootError(`preload ${app.id}`, error);
      return undefined;
    });

  if (timeoutMs <= 0) {
    initialAppReadyPromise = preloadDone;
    return initialAppReadyPromise;
  }

  const timer = new Promise<void>((resolve) => {
    if (typeof setTimeout === "undefined") {
      resolve();
      return;
    }
    setTimeout(resolve, timeoutMs);
  });

  initialAppReadyPromise = Promise.race([preloadDone, timer]);
  return initialAppReadyPromise;
}

/**
 * Returns the shared "initial shell app ready" Promise created by
 * `preloadInitialShellApp()`. If no preload has been kicked off yet, resolves
 * immediately so a caller can never deadlock the boot reveal.
 */
export function awaitInitialShellAppReady(): Promise<void> {
  return initialAppReadyPromise ?? Promise.resolve();
}

/** Test-only: resets the memoized promise so each test runs against a clean boot. */
export function __resetInitialShellAppReadyForTests(): void {
  initialAppReadyPromise = null;
}
