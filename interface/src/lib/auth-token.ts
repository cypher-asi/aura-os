import type { AuthSession } from "../types";

const JWT_STORAGE_KEY = "aura-jwt";
const SESSION_STORAGE_KEY = "aura-session";

export function getStoredJwt(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(JWT_STORAGE_KEY);
}

export function getStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function setStoredAuth(session: AuthSession | null): void {
  if (typeof window === "undefined") return;
  if (session?.access_token) {
    window.localStorage.setItem(JWT_STORAGE_KEY, session.access_token);
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(JWT_STORAGE_KEY);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export function clearStoredAuth(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(JWT_STORAGE_KEY);
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function authHeaders(): Record<string, string> {
  const jwt = getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}
