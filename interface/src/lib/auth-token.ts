import type { AuthSession } from "../types";
import { BROWSER_DB_STORES, browserDbDelete, browserDbGet, browserDbSet } from "./browser-db";

const JWT_STORAGE_KEY = "aura-jwt";
const SESSION_STORAGE_KEY = "aura-session";
const AUTH_RECORD_KEY = "session";

let cachedSession: AuthSession | null = null;
let hydratePromise: Promise<AuthSession | null> | null = null;

function readLegacySession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  const jwt = window.localStorage.getItem(JWT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (parsed?.access_token) {
      return parsed;
    }
    return jwt ? { ...parsed, access_token: jwt } : parsed;
  } catch {
    return null;
  }
}

function clearLegacyStorage(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(JWT_STORAGE_KEY);
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

function normalizeSession(session: AuthSession | null): AuthSession | null {
  return session?.access_token ? session : null;
}

export function getStoredJwt(): string | null {
  return cachedSession?.access_token ?? null;
}

export function getStoredSession(): AuthSession | null {
  return cachedSession;
}

export async function hydrateStoredAuth(): Promise<AuthSession | null> {
  if (hydratePromise) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    const stored = normalizeSession(
      await browserDbGet<AuthSession>(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY),
    );
    if (stored) {
      cachedSession = stored;
      clearLegacyStorage();
      return stored;
    }

    const legacy = normalizeSession(readLegacySession());
    if (legacy) {
      cachedSession = legacy;
      await browserDbSet(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY, legacy);
      clearLegacyStorage();
      return legacy;
    }

    cachedSession = null;
    clearLegacyStorage();
    return null;
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

export async function setStoredAuth(session: AuthSession | null): Promise<void> {
  const normalized = normalizeSession(session);
  cachedSession = normalized;
  if (normalized) {
    await browserDbSet(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY, normalized);
  } else {
    await browserDbDelete(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY);
  }
  clearLegacyStorage();
}

export async function clearStoredAuth(): Promise<void> {
  cachedSession = null;
  await browserDbDelete(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY);
  clearLegacyStorage();
}

export function authHeaders(): Record<string, string> {
  const jwt = getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}
