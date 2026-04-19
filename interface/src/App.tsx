import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useAuthStore } from "./stores/auth-store";
import { useAppUIStore } from "./stores/app-ui-store";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { LoginView } from "./views/LoginView";
import { apps } from "./apps/registry";
import { getInitialShellPath } from "./utils/last-app-path";
import { getLastApp } from "./utils/storage";
import { bootstrapNativeTestAuth } from "./lib/native-test-auth";
import { hydrateStoredAuth, isLoggedInSync } from "./lib/auth-token";

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
  // Live-subscribed auth flag — diverges from `initiallyLoggedIn` only AFTER
  // first paint (on login, logout, or a background 401). The shell branch is
  // entered if either is true so that:
  //   - returning users land on the shell instantly (initiallyLoggedIn)
  //   - a fresh sign-in from the login branch flips the tree to the shell
  //     without requiring a reload (isAuthenticated)
  // There is no boot-time window where an authenticated user renders LoginView
  // because `initiallyLoggedIn` is decided before `App()` first runs.
  const isAuthenticated = useAuthStore((s) => s.user !== null);
  const showShell = initiallyLoggedIn || isAuthenticated;

  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        await hydrateStoredAuth();
        await bootstrapNativeTestAuth();
      } catch (error) {
        console.error("Native test auth bootstrap failed", error);
      } finally {
        if (active) {
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
