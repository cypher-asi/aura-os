import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
  type Location,
} from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { useAuthStore } from "./stores/auth-store";
import { useAuraCapabilities } from "./hooks/use-aura-capabilities";
import { RequireAuth } from "./components/RequireAuth";
import { AppShell } from "./components/AppShell";
import { NativeContextMenuOverride } from "./components/NativeContextMenuOverride";
import { LoginView } from "./views/LoginView";
import { PublicChatView } from "./views/public-chat/PublicChatView";
import { MobilePublicChatView } from "./views/public-chat/MobilePublicChatView";
import { PublicMarketingPanel } from "./views/public-chat/PublicMarketingPanel";
import { LoginOverlay } from "./views/public-chat/LoginOverlay";
import { AgentOnboardingModal } from "./views/public-chat/AgentOnboarding/AgentOnboardingModal";
const OnboardingChoice = lazy(() =>
  import("./views/public-chat/AgentOnboarding/OnboardingChoice").then((m) => ({
    default: m.OnboardingChoice,
  })),
);
import { CaptureLoginView } from "./views/CaptureLoginView";
import { apps } from "./apps/registry";
import { getPlatformEntryShellPath } from "./utils/last-app-path";
import { useEffectiveMode } from "./stores/use-effective-mode";
import { bootstrapNativeTestAuth } from "./lib/native-test-auth";
import { hydrateStoredAuth, isLoggedInSync } from "./shared/lib/auth-token";
import { preloadInitialShellApp } from "./lib/boot-shell";
import { reportBootError } from "./lib/boot-diagnostics";

const InviteAcceptView = lazy(() =>
  import("./views/InviteAcceptView").then((m) => ({ default: m.InviteAcceptView })),
);
const IdeView = lazy(() => import("./views/IdeView").then((m) => ({ default: m.IdeView })));
const ProductView = lazy(() =>
  import("./views/marketing/ProductView").then((m) => ({ default: m.ProductView })),
);
const ExpertiseDetailView = lazy(() =>
  import("./views/marketing/ExpertiseDetailView").then((m) => ({
    default: m.ExpertiseDetailView,
  })),
);
const CodeView = lazy(() =>
  import("./views/marketing/CodeView").then((m) => ({ default: m.CodeView })),
);
const ChangelogView = lazy(() =>
  import("./views/marketing/ChangelogView").then((m) => ({ default: m.ChangelogView })),
);
const FeedbackView = lazy(() =>
  import("./views/marketing/FeedbackView").then((m) => ({ default: m.FeedbackView })),
);
const PricingView = lazy(() =>
  import("./views/marketing/PricingView").then((m) => ({ default: m.PricingView })),
);
const ModelsView = lazy(() =>
  import("./views/marketing/ModelsView").then((m) => ({ default: m.ModelsView })),
);
const StatusView = lazy(() =>
  import("./views/marketing/StatusView").then((m) => ({ default: m.StatusView })),
);
const BlogView = lazy(() =>
  import("./views/marketing/BlogView").then((m) => ({ default: m.BlogView })),
);
const OsView = lazy(() =>
  import("./views/marketing/OsView").then((m) => ({ default: m.OsView })),
);
const DownloadView = lazy(() =>
  import("./views/marketing/DownloadView").then((m) => ({ default: m.DownloadView })),
);
const DocsView = lazy(() =>
  import("./views/marketing/DocsView").then((m) => ({ default: m.DocsView })),
);
const TermsView = lazy(() =>
  import("./views/marketing/TermsView").then((m) => ({ default: m.TermsView })),
);
const PrivacyView = lazy(() =>
  import("./views/marketing/PrivacyView").then((m) => ({ default: m.PrivacyView })),
);
const SupportView = lazy(() =>
  import("./views/marketing/SupportView").then((m) => ({ default: m.SupportView })),
);
const SharedSessionView = lazy(() =>
  import("./views/public-chat/SharedSessionView").then((m) => ({
    default: m.SharedSessionView,
  })),
);
// Lazy: ChatAppRoute drags the full ChatPanel bundle with it, which must
// not land in the entry graph public marketing visitors download. The
// authenticated chat surface loads it on first use instead.
const ChatAppRoute = lazy(() =>
  import("./apps/chat-app/components/ChatAppRoute").then((m) => ({
    default: m.ChatAppRoute,
  })),
);

const initiallyLoggedIn = isLoggedInSync();

if (initiallyLoggedIn) {
  void preloadInitialShellApp();
}

function EntryAppRedirect(): React.ReactElement {
  const { hasDesktopBridge } = useAuraCapabilities();
  return (
    <Navigate
      to={getPlatformEntryShellPath(hasDesktopBridge)}
      replace
    />
  );
}

function RouteFallback(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        color: "var(--color-text-muted)",
        fontSize: 12,
      }}
    >
      Loading...
    </div>
  );
}

/** Keeps AppShell chrome visible while lazy shell routes load (avoids full-app Suspense fallback). */
function ShellOutletSuspense(): React.ReactElement {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  );
}

/**
 * Phase 3 `/chat` route element. Picks the public chat surface
 * (compose banner + agent demo + sessions sidebar) when the
 * effective mode is `public`, otherwise renders the authenticated
 * Chat app's route component so the auth chat panel mounts inside
 * `AuraShell`'s `<main>` slot.
 *
 * Both branches render into the SAME `<Outlet />` slot inside
 * `AuraShell`, so flipping public <-> authed is a content swap, not
 * a shell remount.
 */
function ChatRouteSwitch(): React.ReactElement {
  const effectiveMode = useEffectiveMode();
  const { isMobileLayout } = useAuraCapabilities();
  if (effectiveMode === "public") {
    return isMobileLayout ? <MobilePublicChatView /> : <PublicChatView />;
  }
  return <ChatAppRoute />;
}

/**
 * Phase 3 landing (`/`) route element. Public users see the public
 * chat surface (matching the previous `LoggedOutChatView` route);
 * authenticated users are redirected into the platform's primary app.
 * Web starts in chat; desktop starts in build/projects.
 */
function LandingRoute(): React.ReactElement {
  const effectiveMode = useEffectiveMode();
  const { isMobileLayout } = useAuraCapabilities();
  if (effectiveMode === "public") {
    return isMobileLayout ? <MobilePublicChatView /> : <PublicChatView />;
  }
  return <EntryAppRedirect />;
}

function UnknownRouteRedirect(): React.ReactElement {
  const effectiveMode = useEffectiveMode();
  if (effectiveMode === "public") {
    return <Navigate to="/chat" replace />;
  }
  return <Navigate to="/" replace />;
}

/**
 * Flattened list of app-owned routes. Each `AuraApp.routes[]` entry
 * becomes a `<Route>` under the shared `ShellOutletSuspense` layout
 * so the app module is the single source of truth for the pathnames
 * it handles. The Chat app's `/chat` index is filtered out below
 * because we mount it via `<ChatRouteSwitch>` so the public-mode
 * fallback can render in the same `<main>` slot without route
 * remount.
 */
const shellAppRoutes = apps.flatMap((app) => app.routes);

function isCaptureLoginRoute(location: { pathname: string; search: string }): boolean {
  if (location.pathname === "/capture-login") {
    return true;
  }
  const params = new URLSearchParams(location.search);
  return params.get("capture-login") === "1" || params.get("captureMode") === "login";
}

function renderRoutes(routes: typeof shellAppRoutes): React.ReactNode {
  return routes.map((route, index) => {
    const key = route.path ?? (route.index ? `index-${index}` : String(index));
    // Skip the chat app's `/chat` route here; it's mounted at the
    // parent level as `<ChatRouteSwitch>` so the public-vs-authed
    // picker can swap content without remounting the `<AuraShell>`
    // outlet host.
    if (route.path === "chat") return null;
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

export function App(): React.ReactElement {
  const restoreSession = useAuthStore((s) => s.restoreSession);

  useEffect(() => {
    let active = true;

    void (async () => {
      let shouldRestoreSession = true;
      try {
        if (isCaptureLoginRoute(window.location) && !isLoggedInSync()) {
          shouldRestoreSession = false;
          return;
        }
        await hydrateStoredAuth();
        await bootstrapNativeTestAuth();
      } catch (error) {
        reportBootError("auth bootstrap", error);
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
      <NativeContextMenuOverride />
      <AppRoutes />
    </BrowserRouter>
  );
}

function AppRoutes(): React.ReactElement {
  const location = useLocation();
  const { isNativeApp } = useAuraCapabilities();
  const isAuthenticated = useAuthStore((s) => s.user !== null);

  // "Background location" pattern: when a public-mode visitor opens
  // the login modal from a public page,
  // the trigger navigates to `/login?tab=...` with
  // `state.backgroundLocation` carrying the URL they came from. We
  // drive the desktop/web `<Routes>` matcher off that stashed
  // location so the underlying view (ProductView, PricingView, the
  // public chat surface, etc.) stays mounted while we overlay
  // `LoginOverlay` on top.
  //
  // The overlay is mounted as a sibling of `<Routes>` (below) rather
  // than inside it because `<Routes location={...}>` overrides
  // `LocationContext` for every descendant — `useLocation()` inside
  // would return the background location, not the real `/login`,
  // making any in-tree gating impossible. Mounting outside lets the
  // sibling read `useLocation()` and see the real `/login` URL.
  //
  // Without `backgroundLocation` (direct deep link to `/login`,
  // `RequireAuth`'s `state.from` redirect, etc.) we fall through to
  // the real location and the route table behaves as before — the
  // `/login` path resolves to `<PublicChatView />` underneath.
  // Once authenticated we deliberately drop the stashed background
  // location so the underlying `<Routes>` matcher resolves against the
  // real URL (which the post-login navigate moves into the app). This
  // tears down the public surface the visitor opened the modal from
  // immediately, instead of leaving it mounted under the overlay for a
  // frame while the redirect settles.
  const navState = location.state as { backgroundLocation?: Location } | null;
  const routeLocation =
    !isAuthenticated && navState?.backgroundLocation
      ? navState.backgroundLocation
      : location;
  const showLoginOverlay = location.pathname === "/login";

  if (isCaptureLoginRoute(location)) {
    return (
      <Routes>
        <Route path="*" element={<CaptureLoginView />} />
      </Routes>
    );
  }

  // Native mobile apps continue to mount `LoginView` as a full-page
  // route at `/login` (no underlying public chat surface to overlay).
  if (isNativeApp) {
    return (
      <Routes>
        <Route path="login" element={<LoginView />} />
        <Route path="capture-login" element={<CaptureLoginView />} />
        <Route
          path="ide"
          element={
            <Suspense fallback={<RouteFallback />}>
              <IdeView />
            </Suspense>
          }
        />
        <Route element={<AppShell />}>
          <Route element={<RequireAuth />}>
            <Route element={<ShellOutletSuspense />}>
              <Route index element={<EntryAppRedirect />} />
              {renderRoutes(shellAppRoutes)}
              <Route path="chat" element={<ChatRouteSwitch />} />
              <Route
                path="observability"
                element={
                  <Suspense fallback={null}>
                    <StatusView />
                  </Suspense>
                }
              />
            </Route>
            <Route
              path="invite/:token"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <InviteAcceptView />
                </Suspense>
              }
            />
            {/* Authenticated share viewer on native (no public shell). */}
            <Route
              path="s/:shareToken"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <SharedSessionView />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Route>
      </Routes>
    );
  }

  // Phase 3 desktop/web routing: a single `<AppShell>` parent
  // wraps every route. AppShell provides the provider tree (auth
  // boot, modals, CaptureBridge) and renders `<AuraShell>` for
  // desktop (or `<MobileShell>` on mobile layouts). AuraShell uses
  // `<Outlet />` to mount per-route content in its `<main>` slot.
  // Public subpages (`/agents`, `/code`, `/changelog`, `/feedback`,
  // `/pricing`, `/models`) also mount in this tree under
  // `<PublicMarketingPanel>`, so they share the same public-mode
  // chrome (titlebar + `PublicTopNav` + sidebar) as the public chat
  // surface — only the middle panel content swaps.
  //
  // `LoginOverlay` is mounted as a sibling of `<Routes>` (see
  // `showLoginOverlay` above) so it overlays whichever underlying
  // surface the visitor was on when they opened the modal.
  return (
    <>
    <Routes location={routeLocation}>
      <Route path="capture-login" element={<CaptureLoginView />} />
      <Route
        path="ide"
        element={
          <Suspense fallback={<RouteFallback />}>
            <IdeView />
          </Suspense>
        }
      />
      {/*
        Public support page (App Store Guideline 1.5 Support URL). Mounted as
        a standalone top-level route — outside `AppShell`/`RequireAuth` and the
        `!isAuthenticated` marketing gate — so `aura.ai/support` resolves for
        every visitor, including a reviewer opening it directly while logged
        out. The Render static site's `/*` -> `/index.html` rewrite serves the
        SPA for this deep link.
      */}
      <Route
        path="support"
        element={
          <Suspense fallback={<RouteFallback />}>
            <SupportView />
          </Suspense>
        }
      />
      <Route element={<AppShell />}>
        <Route element={<ShellOutletSuspense />}>
          <Route index element={<LandingRoute />} />
          <Route path="chat" element={<ChatRouteSwitch />} />
          {/*
            Public-only routes. Gated on `!isAuthenticated` so they are
            absent from the route table once logged in — this both
            destroys the public surfaces (PublicChatView SSE / persona
            animations, marketing pages) for efficiency AND prevents the
            marketing `/agents` route from shadowing the authenticated
            Agents app's `/agents` index (both share the same path; with
            both present React Router's tie-break would otherwise resolve
            `/agents` to the marketing `ProductView`, hiding the agent
            selection that `AgentIndexRedirect` performs).

            Public subpages mount inside the public-mode `AuraShell`
            main `<Outlet />` via `PublicMarketingPanel`, a thin
            scroll-column wrapper. Same sidebar / titlebar as the public
            chat surface — just the middle panel content swaps when the
            visitor clicks Agents / Code / Pricing / Resources in
            `PublicTopNav`. Replaces the standalone `MarketingShell`
            chrome that previously owned these paths.
          */}
          {!isAuthenticated && (
            <Route path="login" element={<PublicChatView />} />
          )}
          {!isAuthenticated && (
            <Route element={<PublicMarketingPanel />}>
              <Route
                path="agents"
                element={
                  <Suspense fallback={null}>
                    <ProductView />
                  </Suspense>
                }
              />
              <Route
                path="expertise/:slug"
                element={
                  <Suspense fallback={null}>
                    <ExpertiseDetailView />
                  </Suspense>
                }
              />
              <Route
                path="code"
                element={
                  <Suspense fallback={null}>
                    <CodeView />
                  </Suspense>
                }
              />
              {/*
                `/product` was renamed to `/agents`. Keep a permanent
                redirect so old links / bookmarks still resolve.
              */}
              <Route path="product" element={<Navigate to="/agents" replace />} />
              <Route
                path="changelog"
                element={
                  <Suspense fallback={null}>
                    <ChangelogView />
                  </Suspense>
                }
              />
              <Route
                path="feedback"
                element={
                  <Suspense fallback={null}>
                    <FeedbackView />
                  </Suspense>
                }
              />
              <Route
                path="pricing"
                element={
                  <Suspense fallback={null}>
                    <PricingView />
                  </Suspense>
                }
              />
              <Route
                path="models"
                element={
                  <Suspense fallback={null}>
                    <ModelsView />
                  </Suspense>
                }
              />
              <Route
                path="observability"
                element={
                  <Suspense fallback={null}>
                    <StatusView />
                  </Suspense>
                }
              />
              <Route
                path="blog"
                element={
                  <Suspense fallback={null}>
                    <BlogView />
                  </Suspense>
                }
              />
              <Route
                path="blog/:slug"
                element={
                  <Suspense fallback={null}>
                    <BlogView />
                  </Suspense>
                }
              />
              <Route
                path="os"
                element={
                  <Suspense fallback={null}>
                    <OsView />
                  </Suspense>
                }
              />
              <Route
                path="os/:slug"
                element={
                  <Suspense fallback={null}>
                    <OsView />
                  </Suspense>
                }
              />
              <Route
                path="download"
                element={
                  <Suspense fallback={null}>
                    <DownloadView />
                  </Suspense>
                }
              />
              <Route
                path="docs"
                element={
                  <Suspense fallback={null}>
                    <DocsView />
                  </Suspense>
                }
              />
              <Route
                path="docs/:slug"
                element={
                  <Suspense fallback={null}>
                    <DocsView />
                  </Suspense>
                }
              />
              <Route
                path="terms"
                element={
                  <Suspense fallback={null}>
                    <TermsView />
                  </Suspense>
                }
              />
              <Route
                path="privacy"
                element={
                  <Suspense fallback={null}>
                    <PrivacyView />
                  </Suspense>
                }
              />
              {/*
                ChatGPT-style public share viewer (`https://aura.ai/s/<token>`).
                Mounted inside the `PublicMarketingPanel` group so a
                logged-out visitor opening a shared conversation gets the
                full public-mode chrome — the `AuraTitlebar` `PublicActions`
                Log In / Sign Up pills render in the trailing slot. The view
                fetches the public, unauthenticated transcript endpoint and
                renders it read-only (no action row, no input bar).
              */}
              <Route
                path="s/:shareToken"
                element={
                  <Suspense fallback={null}>
                    <SharedSessionView />
                  </Suspense>
                }
              />
            </Route>
          )}
          <Route element={<RequireAuth />}>
            {renderRoutes(shellAppRoutes)}
            <Route
              path="invite/:token"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <InviteAcceptView />
                </Suspense>
              }
            />
            {/*
              Parallel authenticated Download route. Reuses the SAME
              `DownloadView` as the logged-out marketing route so
              `aura.ai/download` resolves once signed in (the link is
              opened in a new tab from Help > Downloads).
            */}
            <Route
              path="download"
              element={
                <Suspense fallback={null}>
                  <DownloadView />
                </Suspense>
              }
            />
            <Route
              path="observability"
              element={
                <Suspense fallback={null}>
                  <StatusView />
                </Suspense>
              }
            />
            {/*
              Parallel authenticated share route. Reuses the SAME
              `SharedSessionView` but renders inside the normal authed
              `AuraShell` (the public chrome is irrelevant once signed
              in). Both routes read the same public endpoint, so no auth
              header is needed either way.
            */}
            <Route
              path="s/:shareToken"
              element={
                <Suspense fallback={<RouteFallback />}>
                  <SharedSessionView />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<UnknownRouteRedirect />} />
        </Route>
      </Route>
    </Routes>
    {showLoginOverlay && <LoginOverlay />}
    <AgentOnboardingModal />
    {isAuthenticated && <Suspense fallback={null}><OnboardingChoice /></Suspense>}
    </>
  );
}
