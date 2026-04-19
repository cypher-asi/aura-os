import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useAuth, useAuthStore } from "./stores/auth-store";
import { useAppUIStore } from "./stores/app-ui-store";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { LoginView } from "./views/LoginView";
import { apps } from "./apps/registry";
import { getInitialShellPath } from "./utils/last-app-path";
import { getLastApp } from "./utils/storage";
import { bootstrapNativeTestAuth } from "./lib/native-test-auth";
import { hydrateStoredAuth } from "./lib/auth-token";

const InviteAcceptView = lazy(() =>
  import("./views/InviteAcceptView").then((m) => ({ default: m.InviteAcceptView })),
);
const IdeView = lazy(() => import("./views/IdeView").then((m) => ({ default: m.IdeView })));

function LastAppRedirect() {
  const previousPath = useAppUIStore((s) => s.previousPath);
  const lastAppId = getLastApp();
  return <Navigate to={getInitialShellPath(lastAppId, previousPath)} replace />;
}

/**
 * Route-level guard for `/login`. `getInitialAuthState()` seeds `user`
 * synchronously from the localStorage session mirror maintained by
 * `auth-token`, so returning users hit this component with `isAuthenticated`
 * already `true` on the very first render. Redirect them to `/` before
 * `LoginView` ever mounts — this short-circuits any in-component guard
 * races and guarantees the login chrome cannot paint at startup for
 * authenticated users.
 */
function LoginRoute() {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <LoginView />;
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
  // `getInitialAuthState()` seeds `user` synchronously from the localStorage
  // session mirror, so the very first render is already on the correct branch
  // (shell for authenticated users, LoginView for everyone else). That is why
  // this component does NOT gate rendering on any async flag — adding such a
  // gate reintroduced a boot-time window where the Rust 3s fallback could
  // make the webview visible before React committed the correct frame, which
  // is the root cause of the login-screen flash we chased for many commits.
  //
  // The effect below keeps the session fresh in the background: hydrate from
  // IndexedDB, optionally import a native test token, then validate with the
  // server. If the backend returns 401, the auth store clears `user` and
  // `RequireAuth` handles the transition to `/login` — but only after the
  // first paint has already committed the correct-for-now frame.
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
        <Route path="login" element={<LoginRoute />} />
        <Route
          path="ide"
          element={
            <Suspense fallback={null}>
              <IdeView />
            </Suspense>
          }
        />
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
      </Routes>
    </BrowserRouter>
  );
}
