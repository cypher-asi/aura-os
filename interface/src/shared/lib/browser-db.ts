const DB_NAME = "aura-browser-store";
// Bump this when adding new object stores so `onupgradeneeded` creates them.
const DB_VERSION = 2;
const LOCAL_FALLBACK_PREFIX = "aura-idb";

export const BROWSER_DB_STORES = {
  auth: "auth",
  org: "org",
  projects: "projects",
  agents: "agents",
  ui: "ui",
  // Chat transcripts per history key (standalone or project-scoped).
  // Hydrated synchronously-ish on chat mount so the view paints prior
  // messages while the background refetch resolves, rather than flashing
  // a spinner on every app open.
  chatHistory: "chatHistory",
} as const;

export type BrowserDbStoreName =
  (typeof BROWSER_DB_STORES)[keyof typeof BROWSER_DB_STORES];

/**
 * Stores that are allowed to mirror into `localStorage` as a legacy fallback.
 * `chatHistory` is intentionally excluded: transcripts routinely exceed the
 * ~5 MB localStorage quota and every failed `setItem` throws
 * `QuotaExceededError` synchronously from inside IDB event callbacks, which
 * left `browserDbSet` promises pending forever and spammed the console
 * during long spec runs.
 */
const LOCAL_FALLBACK_STORES = new Set<BrowserDbStoreName>([
  BROWSER_DB_STORES.auth,
  BROWSER_DB_STORES.org,
  BROWSER_DB_STORES.projects,
  BROWSER_DB_STORES.agents,
  BROWSER_DB_STORES.ui,
]);

function fallbackKey(store: BrowserDbStoreName, key: string): string {
  return `${LOCAL_FALLBACK_PREFIX}:${store}:${key}`;
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

let sharedDb: IDBDatabase | null = null;
let sharedDbPromise: Promise<IDBDatabase | null> | null = null;

function resetSharedDatabase(db?: IDBDatabase): void {
  if (db && sharedDb && db !== sharedDb) return;
  sharedDb = null;
  sharedDbPromise = null;
}

function closeAndResetSharedDatabase(db: IDBDatabase): void {
  resetSharedDatabase(db);
  try {
    db.close();
  } catch {
    // ignore
  }
}

function retainSharedDatabase(db: IDBDatabase): IDBDatabase {
  sharedDb = db;
  db.onversionchange = () => {
    closeAndResetSharedDatabase(db);
  };
  if ("onclose" in db) {
    (db as IDBDatabase & { onclose: (() => void) | null }).onclose = () => {
      resetSharedDatabase(db);
    };
  }
  return db;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }
  if (sharedDb) {
    return Promise.resolve(sharedDb);
  }
  if (sharedDbPromise) {
    return sharedDbPromise;
  }

  sharedDbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of Object.values(BROWSER_DB_STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };

    request.onsuccess = () => resolve(retainSharedDatabase(request.result));
    request.onerror = () => {
      resetSharedDatabase();
      resolve(null);
    };
  });
  return sharedDbPromise;
}

function readLocalFallback<T>(store: BrowserDbStoreName, key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!LOCAL_FALLBACK_STORES.has(store)) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(fallbackKey(store, key));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeLocalFallback<T>(
  store: BrowserDbStoreName,
  key: string,
  value: T,
): void {
  if (typeof window === "undefined") return;
  if (!LOCAL_FALLBACK_STORES.has(store)) return;
  // Swallow quota / serialization failures: the IDB write is authoritative,
  // and a broken localStorage mirror must never escape an IDB callback.
  try {
    window.localStorage.setItem(fallbackKey(store, key), JSON.stringify(value));
  } catch {
    // no-op
  }
}

function deleteLocalFallback(store: BrowserDbStoreName, key: string): void {
  if (typeof window === "undefined") return;
  if (!LOCAL_FALLBACK_STORES.has(store)) return;
  try {
    window.localStorage.removeItem(fallbackKey(store, key));
  } catch {
    // no-op
  }
}

export async function browserDbGet<T>(
  store: BrowserDbStoreName,
  key: string,
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) {
    return readLocalFallback<T>(store, key);
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(store, "readonly");
      const objectStore = transaction.objectStore(store);
      const request = objectStore.get(key);

      request.onsuccess = () => {
        resolve((request.result as T | undefined) ?? null);
      };
      request.onerror = () => resolve(readLocalFallback<T>(store, key));
      transaction.onerror = () => resolve(readLocalFallback<T>(store, key));
      transaction.onabort = () => resolve(readLocalFallback<T>(store, key));
    } catch {
      resolve(readLocalFallback<T>(store, key));
    }
  });
}

export async function browserDbSet<T>(
  store: BrowserDbStoreName,
  key: string,
  value: T,
): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    writeLocalFallback(store, key, value);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      const transaction = db.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      objectStore.put(value, key);
      transaction.oncomplete = () => {
        writeLocalFallback(store, key, value);
        settle();
      };
      transaction.onerror = () => {
        writeLocalFallback(store, key, value);
        settle();
      };
      transaction.onabort = () => {
        writeLocalFallback(store, key, value);
        settle();
      };
    } catch {
      writeLocalFallback(store, key, value);
      settle();
    }
  });
}

export async function browserDbDelete(
  store: BrowserDbStoreName,
  key: string,
): Promise<void> {
  const db = await openDatabase();
  if (!db) {
    deleteLocalFallback(store, key);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      const transaction = db.transaction(store, "readwrite");
      const objectStore = transaction.objectStore(store);
      objectStore.delete(key);
      transaction.oncomplete = () => {
        deleteLocalFallback(store, key);
        settle();
      };
      transaction.onerror = () => {
        deleteLocalFallback(store, key);
        settle();
      };
      transaction.onabort = () => {
        deleteLocalFallback(store, key);
        settle();
      };
    } catch {
      deleteLocalFallback(store, key);
      settle();
    }
  });
}

/**
 * Clears any legacy `aura-idb:chatHistory:*` entries that earlier builds
 * mirrored into `localStorage`. Those mirrors are the root cause of the
 * `QuotaExceededError` spam on long transcripts; wiping them frees up the
 * ~5 MB budget for the remaining (small) fallback stores.
 *
 * Safe to call on every boot — it's idempotent and bounded by the number of
 * localStorage keys.
 */
export function purgeLegacyChatHistoryFallback(): void {
  if (typeof window === "undefined") return;
  try {
    const prefix = `${LOCAL_FALLBACK_PREFIX}:${BROWSER_DB_STORES.chatHistory}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      try {
        window.localStorage.removeItem(k);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}
