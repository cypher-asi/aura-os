import type { AuthSession } from "../types";
import { BROWSER_DB_STORES, browserDbDelete, browserDbGet, browserDbSet } from "./browser-db";

const JWT_STORAGE_KEY = "aura-jwt";
const SESSION_STORAGE_KEY = "aura-session";
const AUTH_RECORD_KEY = "session";
const AUTH_BROWSER_DB_FALLBACK_KEY = "aura-idb:auth:session";
const BOOT_AUTH_GLOBAL_KEY = "__AURA_BOOT_AUTH__";
/**
 * Sticky "the user has logged out since this webview process started"
 * sentinel. Set by `endLocalSession()` on logout, cleared by `setStoredAuth()`
 * when a fresh session is persisted (login / register / successful restore).
 *
 * The desktop layer bakes auth literals into its initialization script at
 * app startup and re-runs that script on every navigation (including
 * reloads). After logout the literals are stale: without this sentinel a
 * reload would write the old `aura-session` / `aura-jwt` back into
 * localStorage and inject `__AURA_BOOT_AUTH__ = { isLoggedIn: true }`,
 * reviving the just-killed session and producing the classic black-screen
 * redirect loop. This flag lives in the same localStorage the init script
 * writes to, so it survives webview reloads and takes precedence over both
 * the injected boot global and the localStorage mirror.
 */
const FORCE_LOGGED_OUT_KEY = "aura-force-logged-out";
const CAPTURE_ACCESS_TOKEN_PREFIX = "aura-capture:";

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

function isForceLoggedOut(storage: Storage | null): boolean {
  return storage?.getItem(FORCE_LOGGED_OUT_KEY) === "1";
}

/**
 * Wipe every mirror an authenticated session can leave behind in localStorage,
 * INCLUDING the key the desktop initialization script writes before React JS
 * loads. Called both at logout time and from the boot-time seed when the
 * force-logged-out sentinel is set, so a reload with stale baked-in init-script
 * literals never resurrects the dead session.
 */
function clearAllLocalStorageSessionMirrors(storage: Storage): void {
  storage.removeItem(JWT_STORAGE_KEY);
  storage.removeItem(SESSION_STORAGE_KEY);
  storage.removeItem(AUTH_BROWSER_DB_FALLBACK_KEY);
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
  const storage = getLocalStorage();
  // Sentinel takes precedence over every other source: the desktop init
  // script may have just re-written stale session mirrors into localStorage
  // and defined a stale `__AURA_BOOT_AUTH__` (it bakes its literals at app
  // startup, not per-reload), and we must not let those ghosts resurrect a
  // deliberately-ended session. Clear the mirrors — the sentinel itself is
  // cleared by `setStoredAuth` the next time a real session is persisted.
  if (isForceLoggedOut(storage)) {
    bootAuthSource = "none";
    if (storage) clearAllLocalStorageSessionMirrors(storage);
    return null;
  }

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

export function isCaptureAuthSession(session: AuthSession | null = cachedSession): boolean {
  return Boolean(session?.access_token?.startsWith(CAPTURE_ACCESS_TOKEN_PREFIX));
}

export async function hydrateStoredAuth(): Promise<AuthSession | null> {
  if (hydratePromise) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    const storage = getLocalStorage();
    // Honour the force-logged-out sentinel here too: the IDB record and the
    // localStorage mirror may disagree with the seed (e.g. if the desktop
    // init script has re-written a stale `aura-session` after the user
    // logged out). Fall straight through to the cleared state.
    if (isForceLoggedOut(storage)) {
      cachedSession = null;
      if (storage) clearAllLocalStorageSessionMirrors(storage);
      await browserDbDelete(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY);
      return null;
    }

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
    // A real session is going on disk — whatever put the force-logged-out
    // sentinel there (a previous logout) is no longer the current truth.
    getLocalStorage()?.removeItem(FORCE_LOGGED_OUT_KEY);
    await browserDbSet(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY, normalized);
  } else {
    await browserDbDelete(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY);
  }
}

export async function clearStoredAuth(): Promise<void> {
  cachedSession = null;
  const storage = getLocalStorage();
  if (storage) {
    clearAllLocalStorageSessionMirrors(storage);
  }
  await browserDbDelete(BROWSER_DB_STORES.auth, AUTH_RECORD_KEY);
}

/**
 * Explicitly end the local session AND arm the force-logged-out sentinel.
 *
 * This is the variant to call from a user-initiated logout. The sentinel is
 * what lets a subsequent reload survive the desktop initialization script
 * (whose auth literals are baked at app startup and would otherwise re-write
 * a stale `aura-session` / `aura-jwt` into localStorage and redefine
 * `__AURA_BOOT_AUTH__` as logged-in). `setStoredAuth()` clears the sentinel
 * the next time a real session is persisted.
 *
 * Kept as a distinct entry point (rather than bundled into
 * `clearStoredAuth()`) so tests and internal housekeeping callers that use
 * `clearStoredAuth()` purely to tidy up do not inadvertently lock the app
 * into a logged-out state.
 */
export async function endLocalSession(): Promise<void> {
  await clearStoredAuth();
  getLocalStorage()?.setItem(FORCE_LOGGED_OUT_KEY, "1");
}

export function authHeaders(): Record<string, string> {
  const jwt = getStoredJwt();
  return jwt ? { Authorization: `Bearer ${jwt}` } : {};
}
