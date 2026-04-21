import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@cypher-asi/zui";
import "@fontsource-variable/inter";
import "@cypher-asi/zui/styles";
import "highlight.js/styles/github-dark.min.css";
import "./index.css";
import App from "./App";
import { queryClient } from "./lib/query-client";
import { registerServiceWorker } from "./lib/registerServiceWorker";
import {
  installDevPerfHelpers,
  markAppEntry,
  markReactRootRenderScheduled,
} from "./lib/perf/startup-perf";
import { initWebVitalsLite } from "./lib/perf/web-vitals-lite";
import { installPreloadRecovery } from "./lib/preload-recovery";
import { syncQueryHostOriginToStorage } from "./lib/host-config";
import { signalDesktopReady } from "./lib/desktop-ready";
import { awaitInitialShellAppReady } from "./lib/boot-shell";
import { purgeLegacyChatHistoryFallback } from "./lib/browser-db";

// Must run before any module that reads the host origin (e.g. host-store,
// API clients) so a `?host=` bootstrap param wins over stale localStorage.
syncQueryHostOriginToStorage();
installPreloadRecovery();
// Earlier builds mirrored chat transcripts into localStorage as an IDB
// fallback; on long runs that blew the ~5 MB quota and spammed the console
// with `QuotaExceededError`. Clean the stale mirrors out on boot.
purgeLegacyChatHistoryFallback();

markAppEntry();
initWebVitalsLite();
installDevPerfHelpers();

registerServiceWorker();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="dark" defaultAccent="purple">
      <App />
    </ThemeProvider>
  </QueryClientProvider>,
);
markReactRootRenderScheduled();

// Tie the desktop window's first visibility to BOTH (a) React's first committed
// paint, and (b) resolution of the initial shell app's lazy module (see
// `App.tsx` → `preloadInitialShellApp`). Waiting on just first paint reveals a
// window whose first frame contains only shell chrome — the initial route's
// `Suspense` boundary renders `fallback={null}` while its module is still in
// flight, producing a visible "empty shell, then content fills in" blink. By
// joining on the preload Promise (which has its own ~400ms safety timeout so it
// can never deadlock the reveal), the very first on-screen frame already
// contains route content.
//
// `App`'s first render is already the correct branch (authenticated → shell,
// otherwise → login) because of the synchronous boot-auth seed in
// `auth-token.ts`, so the branch is stable by the time we reveal.
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
schedulePostFirstPaint(() => {
  void awaitInitialShellAppReady().then(() => {
    signalDesktopReady();
  });
});
