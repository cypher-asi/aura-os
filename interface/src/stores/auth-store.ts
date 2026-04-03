import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { AuthSession, ZeroUser } from "../types";
import { clearStoredAuth, getStoredSession, setStoredAuth } from "../lib/auth-token";
import { api, ApiClientError } from "../api/client";
import { connectEventSocket, disconnectEventSocket } from "./event-store";

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

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  isLoading: true,
  zeroProRefreshError: null,

  restoreSession: async () => {
    // Restore from localStorage first (instant, no network call)
    const cached = getStoredSession();
    if (cached) {
      set({ user: sessionToUser(cached), zeroProRefreshError: getZeroProRefreshError(cached) });
    }

    // Validate with server to refresh session
    try {
      const validated = await api.auth.validate();
      setStoredAuth(validated);
      set({
        user: sessionToUser(validated),
        zeroProRefreshError: getZeroProRefreshError(validated),
      });
      connectEventSocket();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearStoredAuth();
        disconnectEventSocket();
        set({ user: null, zeroProRefreshError: null });
      } else if (cached) {
        // Non-401 error (e.g. network): keep cached session with event socket
        connectEventSocket();
        set({ zeroProRefreshError: formatZeroProRefreshError(err) });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  refreshSession: async () => {
    set({ isLoading: true, zeroProRefreshError: null });
    try {
      const validated = await api.auth.validate();
      setStoredAuth(validated);
      set({
        user: sessionToUser(validated),
        zeroProRefreshError: getZeroProRefreshError(validated),
      });
      return validated;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearStoredAuth();
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
    const session = await api.auth.login(email, password);
    setStoredAuth(session);
    set({
      user: sessionToUser(session),
      zeroProRefreshError: getZeroProRefreshError(session),
    });
    connectEventSocket();
  },

  register: async (email: string, password: string, name: string, inviteCode: string) => {
    const session = await api.auth.register(email, password, name, inviteCode);
    setStoredAuth(session);
    set({
      user: sessionToUser(session),
      zeroProRefreshError: getZeroProRefreshError(session),
    });
    connectEventSocket();
  },

  logout: async () => {
    await api.auth.logout();
    clearStoredAuth();
    disconnectEventSocket();
    set({ user: null, zeroProRefreshError: null });
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
