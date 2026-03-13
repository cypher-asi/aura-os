import {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import type { AuthSession, ZeroUser } from "../types";
import { api } from "../api/client";
import { ApiClientError } from "../api/client";

interface AuthContextValue {
  user: ZeroUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function sessionToUser(session: AuthSession): ZeroUser {
  return {
    user_id: session.user_id,
    display_name: session.display_name,
    profile_image: session.profile_image,
    primary_zid: session.primary_zid,
    zero_wallet: session.zero_wallet,
    wallets: session.wallets,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ZeroUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession(): Promise<void> {
      try {
        const session = await api.auth.getSession();
        if (cancelled) return;

        try {
          const validated = await api.auth.validate();
          if (!cancelled) setUser(sessionToUser(validated));
        } catch {
          if (!cancelled) setUser(sessionToUser(session));
        }
      } catch (err) {
        if (!cancelled && err instanceof ApiClientError && err.status === 401) {
          setUser(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    restoreSession();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api.auth.login(email, password);
    setUser(sessionToUser(session));
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const session = await api.auth.register(email, password);
    setUser(sessionToUser(session));
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
