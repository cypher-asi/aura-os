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

// Must run before any module that reads the host origin (e.g. host-store,
// API clients) so a `?host=` bootstrap param wins over stale localStorage.
syncQueryHostOriginToStorage();
installPreloadRecovery();

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

// Tie the desktop window's first visibility to React's first committed paint
// rather than to a component-specific `useLayoutEffect` (AppShell / LoginView)
// or a wall-clock fallback in the Rust layer. `App`'s first render is already
// the correct branch (authenticated → shell, otherwise → login) because of
// the synchronous session seed in `auth-token.ts`, so we can reveal the
// window as soon as that frame has painted. The double `requestAnimationFrame`
// lands us AFTER React's commit and the browser's next paint — the definitive
// "correct UI is on-screen now" moment.
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
  signalDesktopReady();
});
