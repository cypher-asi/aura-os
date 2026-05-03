import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@cypher-asi/zui";
import "@fontsource-variable/inter";
import "@cypher-asi/zui/styles";
// App-specific tokens layer on top of ZUI's themes; must come before
// index.css so app-level layout rules can still override token values.
import "./styles/tokens.css";
import "./index.css";
import { App } from "./App";
import { applyHighlightTheme } from "./lib/highlight-theme";
import { HighlightThemeBridge } from "./components/HighlightThemeBridge";
import { queryClient } from "./shared/lib/query-client";
import { registerServiceWorker } from "./lib/registerServiceWorker";
import {
  installDevPerfHelpers,
  markAppEntry,
  markReactRootRenderScheduled,
} from "./lib/perf/startup-perf";
import { initWebVitalsLite } from "./lib/perf/web-vitals-lite";
import { installPreloadRecovery } from "./lib/preload-recovery";
import { installNativeTitlebarDrag } from "./lib/native-titlebar-drag";
import { syncQueryHostOriginToStorage } from "./shared/lib/host-config";
import { signalDesktopReady, signalDesktopSplashReady } from "./lib/desktop-ready";
import { awaitInitialShellAppReady } from "./lib/boot-shell";
import {
  clearBootStatus,
  installBootErrorHandlers,
  markBootPhase,
  reportBootError,
} from "./lib/boot-diagnostics";
import { purgeLegacyChatHistoryFallback } from "./shared/lib/browser-db";
import { bootstrapTaskStreamSubscriptions } from "./stores/task-stream-bootstrap";
import { bootstrapProcessStreamSubscriptions } from "./stores/process-stream-bootstrap";
import { initAnalytics, track } from "./lib/analytics";

// Must run before any module that reads the host origin (e.g. host-store,
// API clients) so a `?host=` bootstrap param wins over stale localStorage.
syncQueryHostOriginToStorage();
installPreloadRecovery();
installBootErrorHandlers();
markBootPhase("frontend module loaded");
// -webkit-app-region: drag works in WebView2 on Windows but is ignored by
// WKWebView (macOS) and WebKitGTK (Linux). Install a JS fallback that
// routes titlebar pointerdown into the existing native-drag IPC.
installNativeTitlebarDrag();

markAppEntry();

// Initialize product analytics (Mixpanel).
// Anonymous by default, no PII. Disabled when VITE_MIXPANEL_TOKEN is unset.
initAnalytics();
track("app_opened");

// Register the app-scoped task stream subscribers BEFORE the first
// component render. Waiting until a component's useEffect runs lets the
// first batch of WS events slip past (a mount race that presents as
// "task row appears, but body never fills in"). Registering here
// guarantees the handlers are in place before the events socket opens.
bootstrapTaskStreamSubscriptions();
// Same pattern for process runs: snapshots the per-node live-output
// stream into localStorage on terminal transitions so a mid-run reload
// can rehydrate the "Live Output" panel without waiting for WS.
bootstrapProcessStreamSubscriptions();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
markBootPhase("rendering React root");
// Sync the highlight.js stylesheet to the data-theme that was stamped
// inline in index.html (pre-React) so the first paint of any code block
// is already in the right palette. The HighlightThemeBridge inside the
// ThemeProvider keeps it in sync on subsequent theme changes.
applyHighlightTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
createRoot(rootEl).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="dark" defaultAccent="purple" disableTransitionOnChange>
      <HighlightThemeBridge />
      <App />
    </ThemeProvider>
  </QueryClientProvider>,
);
markReactRootRenderScheduled();

function scheduleIdle(callback: () => void): void {
  if (typeof window === "undefined") {
    setTimeout(callback, 0);
    return;
  }
  const ric = window.requestIdleCallback?.bind(window);
  if (ric) {
    ric(callback, { timeout: 2_000 });
    return;
  }
  setTimeout(callback, 0);
}

function schedulePostFirstPaint(callback: () => void): void {
  if (typeof window === "undefined") {
    setTimeout(callback, 0);
    return;
  }
  const raf = window.requestAnimationFrame?.bind(window);
  if (!raf) {
    setTimeout(callback, 0);
    return;
  }
  raf(() => raf(callback));
}

function hideBootSplash(): void {
  if (typeof document === "undefined") return;
  const splash = document.getElementById("aura-splash");
  document.documentElement.classList.add("aura-app-ready");
  if (!splash) return;
  window.setTimeout(() => {
    splash.classList.add("aura-splash-hidden");
  }, 220);
}

scheduleIdle(() => {
  initWebVitalsLite();
  installDevPerfHelpers();
  registerServiceWorker();
  // Earlier builds mirrored chat transcripts into localStorage as an IDB
  // fallback; on long runs that blew the ~5 MB quota and spammed the console
  // with `QuotaExceededError`. Clean the stale mirrors outside the first paint.
  purgeLegacyChatHistoryFallback();
});

schedulePostFirstPaint(() => {
  markBootPhase("first paint committed");
  signalDesktopSplashReady();

  // Keep the app-ready signal tied to the existing authenticated-shell preload
  // gate. The native window can show the auth-neutral splash early, while the
  // actual app frame is revealed only after the initial route module is ready.
  void (async () => {
    try {
      markBootPhase("waiting for initial shell app");
      await awaitInitialShellAppReady();
      markBootPhase("initial shell app ready");
    } catch (error) {
      reportBootError("initial shell app readiness", error);
    } finally {
      hideBootSplash();
      clearBootStatus();
      signalDesktopReady();
    }
  })();
});
