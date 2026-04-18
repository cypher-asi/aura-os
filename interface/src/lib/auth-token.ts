import type { AuthSession } from "../types";
import { BROWSER_DB_STORES, browserDbDelete, browserDbGet, browserDbSet } from "./browser-db";

const JWT_STORAGE_KEY = "aura-jwt";
const SESSION_STORAGE_KEY = "aura-session";
const AUTH_RECORD_KEY = "session";

function normalizeSession(session: AuthSession | null): AuthSession | null {
  return session?.access_token ? session : null;
}

/**
 * Synchronously read the stored session from localStorage. localStorage is
 * kept in sync with IndexedDB by `setStoredAuth` / `clearStoredAuth` so this
 * gives us an instant, accurate answer on app startup — before any async
 * IndexedDB read resolves. That instant answer is what prevents the login
 * page from flashing for authenticated users on app open.
 */
function readSyncStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (parsed?.access_token) return parsed;
    const jwt = window.localStorage.getItem(JWT_STORAGE_KEY);
    return normalizeSession(jwt ? { ...parsed, access_token: jwt } : parsed);
  } catch {
    return null;
  }
}

function writeSyncStoredSession(session: AuthSession | null): void {
  if (typeof window === "undefined") return;
  if (session) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    window.localStorage.setItem(JWT_STORAGE_KEY, session.access_token);
  } else {
    window.localStorage.removeItem(JWT_STORAGE_KEY);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

// Seeded synchronously at module import so consumers (the auth store, the API
// client's `authHeaders()`, etc.) have a real session on the very first React
// render for returning users.
let cachedSession: AuthSession | null = readSyncStoredSession();
let hydratePromise: Promise<AuthSession | null> | null = null;

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
      writeSyncStoredSession(stored);
      return stored;
    }

    // IndexedDB may be empty on a device that only has legacy localStorage
    // data, or right after we first started mirroring. Fall back to the sync
    // mirror and seed IndexedDB from it so the two stay in sync afterwards.
    const sync = readSyncStoredSession();
    if (sync) {
      cachedSession = sync;
      await browserDbSet(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY, sync);
      return sync;
    }

    cachedSession = null;
    writeSyncStoredSession(null);
    return null;
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

export async function setStoredAuth(session: AuthSession | null): Promise<void> {
  const normalized = normalizeSession(session);
  cachedSession = normalized;
  writeSyncStoredSession(normalized);
  if (normalized) {
    await browserDbSet(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY, normalized);
  } else {
    await browserDbDelete(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY);
  }
}

export async function clearStoredAuth(): Promise<void> {
  cachedSession = null;
  writeSyncStoredSession(null);
  await browserDbDelete(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY);
}

export function authHeaders(): Record<string, string> {
  const jwt = getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}
