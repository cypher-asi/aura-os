type StoredDraftFile = {
  file: File;
  relativePath: string;
};

const DB_NAME = "aura-new-project-draft";
const STORE_NAME = "draft";
const RECORD_KEY = "current";

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function loadNewProjectDraftFiles(): Promise<StoredDraftFile[]> {
  const db = await openDatabase();
  if (!db) return [];

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(RECORD_KEY);

    request.onsuccess = () => {
      const result = request.result;
      if (!Array.isArray(result)) {
        resolve([]);
        return;
      }
      resolve(
        result.filter((entry): entry is StoredDraftFile => (
          entry &&
          typeof entry === "object" &&
          entry.file instanceof File &&
          typeof entry.relativePath === "string"
        )),
      );
    };

    request.onerror = () => resolve([]);
    transaction.oncomplete = () => db.close();
  });
}

export async function saveNewProjectDraftFiles(files: StoredDraftFile[]): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    if (files.length === 0) {
      store.delete(RECORD_KEY);
    } else {
      store.put(files, RECORD_KEY);
    }

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
}

export async function clearNewProjectDraftFiles(): Promise<void> {
  await saveNewProjectDraftFiles([]);
}
