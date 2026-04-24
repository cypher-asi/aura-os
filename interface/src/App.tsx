import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useAuthStore } from "./stores/auth-store";
import { useAppUIStore } from "./stores/app-ui-store";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { LoginView } from "./views/LoginView";
import { CaptureLoginView } from "./views/CaptureLoginView";
import { apps } from "./apps/registry";
import { getInitialShellPath } from "./utils/last-app-path";
import { getLastApp } from "./utils/storage";
import { bootstrapNativeTestAuth } from "./lib/native-test-auth";
import { hydrateStoredAuth, isLoggedInSync } from "./lib/auth-token";
import { preloadInitialShellApp } from "./lib/boot-shell";

const InviteAcceptView = lazy(() =>
  import("./views/InviteAcceptView").then((m) => ({ default: m.InviteAcceptView })),
);
const IdeView = lazy(() => import("./views/IdeView").then((m) => ({ default: m.IdeView })));

/**
 * Canonical, explicit boot-time auth decision.
 *
 * Computed once at module load via `isLoggedInSync()`. On desktop, that call
 * reads `window.__AURA_BOOT_AUTH__`, a frozen global that the Rust layer
 * defines in the webview initialization script directly from the on-disk
 * `SettingsStore` (see
 * `apps/aura-os-desktop/src/main.rs::build_initialization_script`). Because
 * the global is set before any page scripts run, this boolean is available
 * and correct on the very first React render — no dependence on webview
 * localStorage being populated in time.
 *
 * On web/mobile (no injected global), the same primitive falls back to the
 * localStorage session mirror. The Zustand store's initial seed (in
 * `auth-store.ts`) shares this primitive so the two can never disagree on
 * the first render.
 *
 * If `true`, we mount the authenticated shell routes immediately and never
 * construct `LoginView` at boot. If `false`, `LoginView` is the only thing
 * rendered and `AppShell` is never constructed until the user signs in.
 */
const initiallyLoggedIn = isLoggedInSync();

// Eagerly kick off the lazy-import of the initial shell app's module BEFORE
// React commits its first render. Without this, the first paint lands the shell
// chrome but the initial route's `Suspense` boundary is still rendering
// `fallback={null}` — producing a visible "empty shell, then content fills in"
// blink the moment the desktop window becomes visible. `main.tsx` gates
// `signalDesktopReady()` on this Promise (see `awaitInitialShellAppReady`), so
// the first on-screen frame already contains real content.
// Skipped when we're rendering `LoginView` at boot: the login view is
// statically imported and there's no shell code to warm.
if (initiallyLoggedIn) {
  void preloadInitialShellApp();
}

function LastAppRedirect() {
  const previousPath = useAppUIStore((s) => s.previousPath);
  const lastAppId = getLastApp();
  return <Navigate to={getInitialShellPath(lastAppId, previousPath)} replace />;
}

/** Keeps AppShell chrome visible while lazy shell routes load (avoids full-app Suspense fallback). */
function ShellOutletSuspense() {
  return (
    <Suspense fallback={null}>
      <Outlet />
    </Suspense>
  );
}

/**
 * Flattened list of app-owned routes. Each `AuraApp.routes[]` entry becomes a
 * `<Route>` under the shared `ShellOutletSuspense` layout, so the app module
 * is the single source of truth for the pathnames it handles.
 */
const shellAppRoutes = apps.flatMap((app) => app.routes);

function isCaptureLoginRoute(): boolean {
  return typeof window !== "undefined" && window.location.pathname === "/capture-login";
}

function renderRoutes(routes: typeof shellAppRoutes): React.ReactNode {
  return routes.map((route, index) => {
    const key = route.path ?? (route.index ? `index-${index}` : String(index));
    if (route.index) {
      return <Route key={key} index element={route.element} />;
    }
    return (
      <Route key={key} path={route.path} element={route.element}>
        {route.children ? renderRoutes(route.children) : null}
      </Route>
    );
  });
}

export default function App() {
  // `initiallyLoggedIn` is the synchronous boot-time decision — a frozen
  // snapshot from module load. It exists ONLY to keep returning users on the
  // shell during the very first render (no login flash). Once the auth store
  // has resolved its initial session (login succeeded, logout fired, 401
  // cleared the cache, or `restoreSession` returned), live state is the only
  // truth. If we kept OR-ing `initiallyLoggedIn` forever, a logout would
  // leave `showShell === true` with `user === null` — `RequireAuth`
  // redirects to `/login`, the `/login` route sees `showShell === true` and
  // `<Navigate to="/" replace />`s back to `/`, producing a black-screen
  // redirect loop until the user manually purges the on-disk SettingsStore.
  const isAuthenticated = useAuthStore((s) => s.user !== null);
  const hasResolvedInitialSession = useAuthStore((s) => s.hasResolvedInitialSession);
  const showShell =
    isAuthenticated || (initiallyLoggedIn && !hasResolvedInitialSession);

  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    let active = true;

    void (async () => {
      let shouldRestoreSession = true;
      try {
        if (isCaptureLoginRoute() && !isLoggedInSync()) {
          shouldRestoreSession = false;
          return;
        }
        await hydrateStoredAuth();
        await bootstrapNativeTestAuth();
      } catch (error) {
        console.error("Native test auth bootstrap failed", error);
      } finally {
        if (active && shouldRestoreSession) {
          await restoreSession();
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [restoreSession]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="login"
          element={showShell ? <Navigate to="/" replace /> : <LoginView />}
        />
        <Route path="capture-login" element={<CaptureLoginView />} />
        <Route
          path="ide"
          element={
            <Suspense fallback={null}>
              <IdeView />
            </Suspense>
          }
        />
        {showShell ? (
          <Route element={<RequireAuth />}>
            <Route
              path="invite/:token"
              element={
                <Suspense fallback={null}>
                  <InviteAcceptView />
                </Suspense>
              }
            />
            <Route element={<AppShell />}>
              <Route element={<ShellOutletSuspense />}>
                <Route index element={<LastAppRedirect />} />
                {renderRoutes(shellAppRoutes)}
              </Route>
            </Route>
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/login" replace />} />
        )}
      </Routes>
    </BrowserRouter>
  );
}
