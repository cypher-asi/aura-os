import type { AuthSession } from "../types";
import { BROWSER_DB_STORES, browserDbDelete, browserDbGet, browserDbSet } from "./browser-db";

const JWT_STORAGE_KEY = "aura-jwt";
const SESSION_STORAGE_KEY = "aura-session";
const AUTH_RECORD_KEY = "session";
const AUTH_BROWSER_DB_FALLBACK_KEY = "aura-idb:auth:session";

function normalizeSession(session: AuthSession | null): AuthSession | null {
  return session?.access_token ? session : null;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  const storage = window.localStorage;
  return storage &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
    ? storage
    : null;
}

function parseStoredSession(raw: string | null, jwt: string | null): AuthSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (parsed?.access_token) return parsed;
    return normalizeSession(jwt ? { ...parsed, access_token: jwt } : parsed);
  } catch {
    return null;
  }
}

/**
 * Synchronously read the stored session from localStorage. localStorage is
 * kept in sync with IndexedDB by `setStoredAuth` / `clearStoredAuth` so this
 * gives us an instant, accurate answer on app startup — before any async
 * IndexedDB read resolves. That instant answer is what prevents the login
 * page from flashing for authenticated users on app open.
 */
function readSyncStoredSession(): AuthSession | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  const jwt = storage.getItem(JWT_STORAGE_KEY);
  const direct = parseStoredSession(storage.getItem(SESSION_STORAGE_KEY), jwt);
  if (direct) return direct;

  // `browser-db.ts` mirrors IndexedDB writes into a localStorage fallback key.
  // Read it synchronously here too so startup can recover even if the direct
  // `aura-session` mirror is missing but the IndexedDB fallback mirror exists.
  return parseStoredSession(storage.getItem(AUTH_BROWSER_DB_FALLBACK_KEY), jwt);
}

function writeSyncStoredSession(session: AuthSession | null): void {
  const storage = getLocalStorage();
  if (!storage) return;
  if (session) {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    if (session.access_token) {
      storage.setItem(JWT_STORAGE_KEY, session.access_token);
    } else {
      storage.removeItem(JWT_STORAGE_KEY);
    }
  } else {
    storage.removeItem(JWT_STORAGE_KEY);
    storage.removeItem(SESSION_STORAGE_KEY);
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
