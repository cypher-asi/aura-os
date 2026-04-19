import type { AuthSession } from "../types";
import { BROWSER_DB_STORES, browserDbDelete, browserDbGet, browserDbSet } from "./browser-db";

const JWT_STORAGE_KEY = "aura-jwt";
const SESSION_STORAGE_KEY = "aura-session";
const AUTH_RECORD_KEY = "session";
const AUTH_BROWSER_DB_FALLBACK_KEY = "aura-idb:auth:session";
const BOOT_AUTH_GLOBAL_KEY = "__AURA_BOOT_AUTH__";

interface BootInjectedAuth {
  isLoggedIn: boolean;
  session: AuthSession | null;
  jwt: string | null;
}

type BootAuthSource = "injected" | "localStorage" | "none";
let bootAuthSource: BootAuthSource = "none";

export function getBootAuthSource(): BootAuthSource {
  return bootAuthSource;
}

function normalizeSession(session: AuthSession | null): AuthSession | null {
  return session?.access_token ? session : null;
}

/**
 * On desktop, `apps/aura-os-desktop/src/main.rs::build_initialization_script`
 * defines `window.__AURA_BOOT_AUTH__` before any page scripts run, sourced
 * directly from the on-disk `SettingsStore` via
 * `get_cached_zero_auth_session()`. That global is the authoritative
 * "is the user logged in at boot?" signal: it is set before React JS is
 * parsed, is immune to webview localStorage quirks, and carries the full
 * session payload so the auth store can be seeded without any storage read.
 *
 * Returns `null` when the global is absent (web / mobile / tests) so callers
 * can fall back to the localStorage mirror.
 */
function readBootInjectedAuth(): BootInjectedAuth | null {
  if (typeof window === "undefined") return null;
  const raw = (window as unknown as Record<string, unknown>)[BOOT_AUTH_GLOBAL_KEY];
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<BootInjectedAuth>;
  if (typeof candidate.isLoggedIn !== "boolean") return null;
  return {
    isLoggedIn: candidate.isLoggedIn,
    session: candidate.session ?? null,
    jwt: typeof candidate.jwt === "string" ? candidate.jwt : null,
  };
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

/**
 * Seed `cachedSession` synchronously at module import. Preference order:
 *   1. `window.__AURA_BOOT_AUTH__` injected by the desktop Rust layer
 *      (authoritative, read directly from the on-disk SettingsStore).
 *   2. The localStorage mirror maintained by `setStoredAuth` / the
 *      `browser-db` IDB fallback key (used for web/mobile and as a
 *      compatibility path on desktop).
 * The ordering means the login-vs-shell boot decision never depends on
 * webview localStorage being populated before React's module code runs.
 */
function seedCachedSessionFromBoot(): AuthSession | null {
  const injected = readBootInjectedAuth();
  if (injected) {
    bootAuthSource = "injected";
    if (!injected.isLoggedIn) return null;
    const session = normalizeSession(
      injected.session
        ? injected.jwt && !injected.session.access_token
          ? { ...injected.session, access_token: injected.jwt }
          : injected.session
        : null,
    );
    return session;
  }
  const sync = readSyncStoredSession();
  bootAuthSource = sync ? "localStorage" : "none";
  return sync;
}

let cachedSession: AuthSession | null = seedCachedSessionFromBoot();
let hydratePromise: Promise<AuthSession | null> | null = null;

if (typeof console !== "undefined" && typeof console.info === "function") {
  // One-line diagnostic so a real boot can confirm the injected path is being
  // taken. Kept intentionally short; remove once the desktop flash is
  // verified gone in production.
  console.info("[aura-boot-auth]", {
    source: bootAuthSource,
    isLoggedIn: Boolean(cachedSession?.access_token),
  });
}

export function getStoredJwt(): string | null {
  return cachedSession?.access_token ?? null;
}

export function getStoredSession(): AuthSession | null {
  return cachedSession;
}

/**
 * Explicit, synchronous "is the user logged in?" primitive used at app boot
 * to decide between the authenticated shell and `LoginView` before any async
 * work runs. Derives purely from the localStorage/IndexedDB-mirrored session
 * seeded into `cachedSession` at module import. Callers (routing in App.tsx
 * and the Zustand auth store seed) MUST share this primitive so the boot
 * decision is consistent across the tree.
 */
export function isLoggedInSync(): boolean {
  return Boolean(cachedSession?.access_token);
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
