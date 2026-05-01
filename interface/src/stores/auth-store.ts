import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { AuthSession, ZeroUser } from "../shared/types";
import {
  endLocalSession,
  getStoredSession,
  hydrateStoredAuth,
  isCaptureAuthSession,
  isLoggedInSync,
  setStoredAuth,
} from "../shared/lib/auth-token";
import { authApi } from "../shared/api/auth";
import { ApiClientError } from "../shared/api/core";
import { disconnectEventSocket, scheduleDeferredEventSocketConnect } from "./event-store";
import { markAuthRestoreComplete } from "../lib/perf/startup-perf";

async function loadAndRunShellRealtimeBootstrap(): Promise<void> {
  const { bootstrapAuthenticatedShellStores } = await import("./authenticated-realtime");
  bootstrapAuthenticatedShellStores();
}

function sessionToUser(session: AuthSession): ZeroUser {
  return {
    user_id: session.user_id,
    network_user_id: session.network_user_id,
    profile_id: session.profile_id,
    display_name: session.display_name,
    profile_image: session.profile_image,
    primary_zid: session.primary_zid,
    zero_wallet: session.zero_wallet,
    wallets: session.wallets,
    is_zero_pro: session.is_zero_pro,
    is_access_granted: session.is_access_granted,
  };
}

function getZeroProRefreshError(session: AuthSession): string | null {
  return session.zero_pro_refresh_error ?? null;
}

function isUnauthenticatedCaptureLoginRoute(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.pathname === "/capture-login" &&
    getStoredSession() === null
  );
}

async function bootstrapShellForSession(session: AuthSession): Promise<void> {
  if (isCaptureAuthSession(session)) {
    return;
  }
  await loadAndRunShellRealtimeBootstrap();
}

async function startRealtimeForSession(session: AuthSession): Promise<void> {
  await bootstrapShellForSession(session);
  if (isCaptureAuthSession(session)) {
    return;
  }
  scheduleDeferredEventSocketConnect();
}

function formatZeroProRefreshError(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Unable to verify ZERO Pro status right now.";
}

interface AuthState {
  user: ZeroUser | null;
  isLoading: boolean;
  /**
   * Flips `true` exactly once, after the first boot-time `restoreSession()`
   * (or a login/register/logout) finishes. This field is now informational
   * only — no component gates rendering on it. The boot-flash fix lives in
   * the render layer: `getInitialAuthState()` seeds `user` synchronously
   * from the localStorage session mirror, so the very first React paint is
   * already on the correct branch, and `main.tsx` ties desktop-window
   * visibility to that first paint (not to this flag).
   */
  hasResolvedInitialSession: boolean;
  zeroProRefreshError: string | null;
  restoreSession: () => Promise<void>;
  refreshSession: () => Promise<AuthSession>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, inviteCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Seed the auth store synchronously from whichever source `auth-token`
 * picked at module import: on desktop that is the `window.__AURA_BOOT_AUTH__`
 * global injected by the Rust initialization script (read from the on-disk
 * `SettingsStore`); on web/mobile it is the localStorage/IndexedDB mirror.
 * Either way this uses the shared `isLoggedInSync()` primitive so the store
 * and the router in `App.tsx` can never disagree on the boot decision.
 *
 * The canonical boot-time "show shell vs show login" decision is made in
 * `App.tsx` via `initiallyLoggedIn = isLoggedInSync()` at module scope. This
 * seed exists purely so consumers of `useAuth().user` (e.g. API headers,
 * user-name display) have a populated user object on the very first render
 * for returning users, matching that routing decision.
 */
function seedAuthStateFromStorage(): Pick<
  AuthState,
  "user" | "isLoading" | "hasResolvedInitialSession" | "zeroProRefreshError"
> {
  if (isLoggedInSync()) {
    const cached = getStoredSession();
    if (cached) {
      return {
        user: sessionToUser(cached),
        isLoading: false,
        hasResolvedInitialSession: false,
        zeroProRefreshError: getZeroProRefreshError(cached),
      };
    }
  }
  return {
    user: null,
    isLoading: true,
    hasResolvedInitialSession: false,
    zeroProRefreshError: null,
  };
}

export const useAuthStore = create<AuthState>()((set) => ({
  ...seedAuthStateFromStorage(),

  restoreSession: async () => {
    if (isUnauthenticatedCaptureLoginRoute()) {
      set({ isLoading: false, hasResolvedInitialSession: true });
      markAuthRestoreComplete();
      return;
    }

    await hydrateStoredAuth();

    const cached = getStoredSession();
    const hadCachedSession = Boolean(cached);
    const prevZeroProErr = cached ? getZeroProRefreshError(cached) : null;
    if (cached) {
      set({
        user: sessionToUser(cached),
        zeroProRefreshError: getZeroProRefreshError(cached),
        isLoading: false,
      });
      await bootstrapShellForSession(cached);
    }

    try {
      // GET /api/auth/session: middleware may use the server TTL cache (no duplicate zOS work in the handler).
      const validated = await authApi.getSession();
      await setStoredAuth(validated);
      set({
        user: sessionToUser(validated),
        zeroProRefreshError: getZeroProRefreshError(validated) ?? prevZeroProErr,
      });
      await startRealtimeForSession(validated);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        // A 401 on the boot-time validate means this session is genuinely
        // dead. Arm the sentinel in addition to clearing state so a manual
        // reload (which re-runs the desktop init script with stale baked
        // auth literals) cannot resurrect the same expired session.
        await endLocalSession();
        disconnectEventSocket();
        set({ user: null, zeroProRefreshError: null });
      } else if (hadCachedSession) {
        // Non-401 error (e.g. network): keep cached session with event socket
        if (cached && !isCaptureAuthSession(cached)) {
          scheduleDeferredEventSocketConnect();
        }
        set({ zeroProRefreshError: formatZeroProRefreshError(err) });
      }
    } finally {
      set({ isLoading: false, hasResolvedInitialSession: true });
      markAuthRestoreComplete();
    }
  },

  refreshSession: async () => {
    set({ isLoading: true, zeroProRefreshError: null });
    try {
      const validated = await authApi.validate();
      await setStoredAuth(validated);
      set({
        user: sessionToUser(validated),
        zeroProRefreshError: getZeroProRefreshError(validated),
      });
      return validated;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await endLocalSession();
        set({ user: null, zeroProRefreshError: null });
        throw err;
      }
      set({
        zeroProRefreshError: formatZeroProRefreshError(err),
      });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (email: string, password: string) => {
    const session = await authApi.login(email, password);
    await setStoredAuth(session);
    const user = sessionToUser(session);
    set({
      user,
      hasResolvedInitialSession: true,
      zeroProRefreshError: getZeroProRefreshError(session),
    });
    await startRealtimeForSession(session);
    import("../lib/analytics").then(({ track, identifyUser }) => {
      if (user?.user_id) identifyUser(user.user_id);
      track("user_logged_in");
    });
  },

  register: async (email: string, password: string, name: string, inviteCode: string) => {
    const session = await authApi.register(email, password, name, inviteCode);
    await setStoredAuth(session);
    const user = sessionToUser(session);
    set({
      user,
      hasResolvedInitialSession: true,
      zeroProRefreshError: getZeroProRefreshError(session),
    });
    await startRealtimeForSession(session);
    import("../lib/analytics").then(({ track, identifyUser }) => {
      if (user?.user_id) identifyUser(user.user_id);
      track("user_signed_up", { has_invite_code: !!inviteCode });
    });
  },

  logout: async () => {
    // Local cleanup MUST run even when the server call fails, otherwise a
    // transient network error or an already-expired JWT leaves localStorage,
    // IndexedDB, the event socket, and the zustand user pointing at a stale
    // session. That stale state is exactly what produces the post-logout
    // black screen: on the next reload the desktop initialization script
    // re-injects the baked startup auth literals, the app hydrates a
    // user-looking session, and `RequireAuth`/`/login` fight an infinite
    // redirect loop. Swallow server errors here; the server also clears its
    // on-disk cache before its upstream call, so the persisted state is
    // already wiped by the time we return from `authApi.logout()` even when
    // the upstream zOS call errors out.
    try {
      await authApi.logout();
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("authApi.logout() failed; clearing local session anyway", err);
      }
    }
    await endLocalSession();
    disconnectEventSocket();
    // Setting `hasResolvedInitialSession: true` flips the App.tsx gate so
    // `showShell` immediately follows the live (`user === null`) state
    // instead of the sticky `initiallyLoggedIn` boot snapshot. React Router
    // then renders `LoginView` in-place — no `window.location.href` reload
    // is needed, and avoiding the reload also avoids re-running the
    // desktop initialization script (which carries startup-time auth
    // literals that would otherwise clobber the just-cleared localStorage).
    set({ user: null, hasResolvedInitialSession: true, zeroProRefreshError: null });
  },
}));

/**
 * Drop-in replacement for the old useAuth() context hook.
 * Returns the same shape so existing destructuring patterns keep working.
 */
export function useAuth() {
  return useAuthStore(
    useShallow((s) => ({
      user: s.user,
      isAuthenticated: s.user !== null,
      isLoading: s.isLoading,
      hasResolvedInitialSession: s.hasResolvedInitialSession,
      zeroProRefreshError: s.zeroProRefreshError,
      refreshSession: s.refreshSession,
      login: s.login,
      register: s.register,
      logout: s.logout,
    })),
  );
}
