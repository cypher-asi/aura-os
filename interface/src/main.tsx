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
import { ThemeOverridesBridge } from "./components/ThemeOverridesBridge";
import { PanelGlassBridge } from "./components/PanelGlassBridge";
import { ThemeExtrasBridge } from "./components/ThemeExtrasBridge";
import { BrowserChromeThemeBridge } from "./components/BrowserChromeThemeBridge";
import { GalleryProvider } from "./components/Gallery";
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
import { installNativeTitlebarResize } from "./lib/native-titlebar-resize";
import { syncQueryHostOriginToStorage } from "./shared/lib/host-config";
import { signalDesktopReady, signalDesktopSplashReady } from "./lib/desktop-ready";
import { awaitInitialShellAppReady } from "./lib/boot-shell";
import {
  clearBootStatus,
  installBootErrorHandlers,
  markBootPhase,
  markStoragePressure,
  reportBootError,
} from "./lib/boot-diagnostics";
import { purgeLegacyChatHistoryFallback } from "./shared/lib/browser-db";
import { bootstrapTaskStreamSubscriptions } from "./stores/task-stream-bootstrap";
import { bootstrapProcessStreamSubscriptions } from "./stores/process-stream-bootstrap";
import { bootstrapChatHistoryInvalidator } from "./stores/chat-history-invalidator-bootstrap";
import { initAnalytics, track } from "./lib/analytics";

// Must run before any module that reads the host origin (e.g. host-store,
// API clients) so a `?host=` bootstrap param wins over stale localStorage.
syncQueryHostOriginToStorage();
installPreloadRecovery();
installBootErrorHandlers();
markStoragePressure();
markBootPhase("frontend module loaded");
// -webkit-app-region: drag works in WebView2 on Windows but is ignored by
// WKWebView (macOS) and WebKitGTK (Linux). Install a JS fallback that
// routes titlebar pointerdown into the existing native-drag IPC.
installNativeTitlebarDrag();
// The web layer can see pointer events even when the native WebView2 /
// WKWebView / WebKitGTK child swallows them before they reach tao's
// edge resize detection, so we install a document-level top-band
// resize handler that IPCs `resize-n` for the Rust side to forward to
// `tao::Window::drag_resize_window(North)`. See
// `lib/native-titlebar-resize.ts` and the doc comment over
// `TOP_RESIZE_BORDER_LOGICAL_PX` in
// `apps/aura-os-desktop/src/ui/chrome.rs` for the full architecture.
installNativeTitlebarResize();

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
// App-global chat-history cache invalidator. The mounted-panel
// `useChatHistorySync` hook only force-refetches when the panel is
// visible, which leaves cross-agent writes (`send_to_agent`) invisible
// on the recipient's panel until a manual refresh: the WS event fires
// while the recipient panel is unmounted, the cache stays warm under
// `HISTORY_TTL_MS = 30s`, and the next navigation re-uses stale data.
// This bootstrap installs a global subscriber that marks every
// possibly-affected chat-history key stale on `user_message` /
// `assistant_message_end`, so the next `fetchHistory` re-hits the
// server. See `stores/chat-history-invalidator-bootstrap.ts`.
bootstrapChatHistoryInvalidator();

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
    <ThemeProvider defaultTheme="dark" defaultAccent="cyan" disableTransitionOnChange>
      <HighlightThemeBridge />
      <ThemeOverridesBridge />
      <PanelGlassBridge />
      <ThemeExtrasBridge />
      <BrowserChromeThemeBridge />
      <GalleryProvider>
        <App />
      </GalleryProvider>
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

function markAppReady(): void {
  if (typeof document === "undefined") return;
  // Hides the fallback titlebar; the branded splash is no longer shown during
  // a normal boot (it only renders the boot-error fallback now).
  document.documentElement.classList.add("aura-app-ready");
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

  // Reveal the native window only after the initial route module is ready, so
  // the window appears showing real content instead of an intermediate
  // loading frame. The native 15s fallback reveal still covers catastrophic
  // bundle failures (and surfaces the boot-error fallback) if this never runs.
  void (async () => {
    try {
      markBootPhase("waiting for initial shell app");
      await awaitInitialShellAppReady();
      markBootPhase("initial shell app ready");
    } catch (error) {
      reportBootError("initial shell app readiness", error);
    } finally {
      markAppReady();
      clearBootStatus();
      signalDesktopSplashReady();
      signalDesktopReady();
    }
  })();
});
