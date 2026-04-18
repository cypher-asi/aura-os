import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { AuthSession, ZeroUser } from "../types";
import {
  clearStoredAuth,
  getStoredSession,
  hydrateStoredAuth,
  setStoredAuth,
} from "../lib/auth-token";
import { authApi } from "../api/auth";
import { ApiClientError } from "../api/core";
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

function formatZeroProRefreshError(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Unable to verify ZERO Pro status right now.";
}

interface AuthState {
  user: ZeroUser | null;
  isLoading: boolean;
  zeroProRefreshError: string | null;
  restoreSession: () => Promise<void>;
  refreshSession: () => Promise<AuthSession>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, inviteCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Compute the initial store state synchronously from the localStorage mirror
 * maintained by `auth-token`. This means authenticated users start with a real
 * `user` on the very first React render, so the login route never flashes
 * before the async `restoreSession()` catches up.
 */
function getInitialAuthState(): Pick<
  AuthState,
  "user" | "isLoading" | "zeroProRefreshError"
> {
  const cached = getStoredSession();
  if (cached) {
    return {
      user: sessionToUser(cached),
      isLoading: false,
      zeroProRefreshError: getZeroProRefreshError(cached),
    };
  }
  return { user: null, isLoading: true, zeroProRefreshError: null };
}

export const useAuthStore = create<AuthState>()((set) => ({
  ...getInitialAuthState(),

  restoreSession: async () => {
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
      await loadAndRunShellRealtimeBootstrap();
    }

    try {
      // GET /api/auth/session: middleware may use the server TTL cache (no duplicate zOS work in the handler).
      const validated = await authApi.getSession();
      await setStoredAuth(validated);
      set({
        user: sessionToUser(validated),
        zeroProRefreshError: getZeroProRefreshError(validated) ?? prevZeroProErr,
      });
      await loadAndRunShellRealtimeBootstrap();
      scheduleDeferredEventSocketConnect();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await clearStoredAuth();
        disconnectEventSocket();
        set({ user: null, zeroProRefreshError: null });
      } else if (hadCachedSession) {
        // Non-401 error (e.g. network): keep cached session with event socket
        scheduleDeferredEventSocketConnect();
        set({ zeroProRefreshError: formatZeroProRefreshError(err) });
      }
    } finally {
      set({ isLoading: false });
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
        await clearStoredAuth();
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
    set({
      user: sessionToUser(session),
      zeroProRefreshError: getZeroProRefreshError(session),
    });
    await loadAndRunShellRealtimeBootstrap();
    scheduleDeferredEventSocketConnect();
  },

  register: async (email: string, password: string, name: string, inviteCode: string) => {
    const session = await authApi.register(email, password, name, inviteCode);
    await setStoredAuth(session);
    set({
      user: sessionToUser(session),
      zeroProRefreshError: getZeroProRefreshError(session),
    });
    await loadAndRunShellRealtimeBootstrap();
    scheduleDeferredEventSocketConnect();
  },

  logout: async () => {
    await authApi.logout();
    await clearStoredAuth();
    disconnectEventSocket();
    set({ user: null, zeroProRefreshError: null });
    window.location.href = "/login";
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
      zeroProRefreshError: s.zeroProRefreshError,
      refreshSession: s.refreshSession,
      login: s.login,
      register: s.register,
      logout: s.logout,
    })),
  );
}
