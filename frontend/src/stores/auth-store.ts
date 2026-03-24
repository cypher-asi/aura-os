import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { AuthSession, ZeroUser } from "../types";
import { api, ApiClientError } from "../api/client";

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
  };
}

interface AuthState {
  user: ZeroUser | null;
  isLoading: boolean;
  zeroProRefreshError: string | null;
  restoreSession: () => Promise<void>;
  refreshSession: () => Promise<AuthSession>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  isLoading: true,
  zeroProRefreshError: null,

  restoreSession: async () => {
    try {
      const session = await api.auth.getSession();
      try {
        const validated = await api.auth.validate();
        set({ user: sessionToUser(validated), zeroProRefreshError: null });
      } catch (err) {
        set({
          user: sessionToUser(session),
          zeroProRefreshError:
            err instanceof Error
              ? err.message
              : "Unable to verify ZERO Pro status right now.",
        });
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        set({ user: null, zeroProRefreshError: null });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  refreshSession: async () => {
    set({ isLoading: true, zeroProRefreshError: null });
    try {
      const validated = await api.auth.validate();
      set({ user: sessionToUser(validated), zeroProRefreshError: null });
      return validated;
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        set({ user: null });
      }
      set({
        zeroProRefreshError:
          err instanceof Error
            ? err.message
            : "Unable to verify ZERO Pro status right now.",
      });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  login: async (email: string, password: string) => {
    const session = await api.auth.login(email, password);
    set({ user: sessionToUser(session), zeroProRefreshError: null });
  },

  register: async (email: string, password: string) => {
    const session = await api.auth.register(email, password);
    set({ user: sessionToUser(session), zeroProRefreshError: null });
  },

  logout: async () => {
    await api.auth.logout();
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
