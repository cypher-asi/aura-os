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

function fallbackKey(store: BrowserDbStoreName, key: string): string {
  return `${LOCAL_FALLBACK_PREFIX}:${store}:${key}`;
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of Object.values(BROWSER_DB_STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function readLocalFallback<T>(store: BrowserDbStoreName, key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(fallbackKey(store, key));
  if (!raw) {
    return null;
  }
  try {
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
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(fallbackKey(store, key), JSON.stringify(value));
}

function deleteLocalFallback(store: BrowserDbStoreName, key: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(fallbackKey(store, key));
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
    const transaction = db.transaction(store, "readonly");
    const objectStore = transaction.objectStore(store);
    const request = objectStore.get(key);

    request.onsuccess = () => {
      resolve((request.result as T | undefined) ?? null);
    };
    request.onerror = () => resolve(readLocalFallback<T>(store, key));
    transaction.oncomplete = () => db.close();
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
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    objectStore.put(value, key);
    transaction.oncomplete = () => {
      db.close();
      writeLocalFallback(store, key, value);
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      writeLocalFallback(store, key, value);
      resolve();
    };
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
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    objectStore.delete(key);
    transaction.oncomplete = () => {
      db.close();
      deleteLocalFallback(store, key);
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      deleteLocalFallback(store, key);
      resolve();
    };
  });
}
