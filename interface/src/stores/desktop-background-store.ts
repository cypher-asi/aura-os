import { create } from "zustand";

const STORAGE_KEY = "aura:desktopBackground";
const DB_NAME = "aura-desktop-bg";
const DB_STORE = "background";

interface PersistedState {
  mode: "color" | "image" | "none";
  color: string;
  imageDataUrl: string;
}

interface DesktopBackgroundState extends PersistedState {
  setColor: (color: string) => void;
  setImage: (dataUrl: string) => void;
  clearBackground: () => void;
}

const DEFAULTS: PersistedState = { mode: "none", color: "", imageDataUrl: "" };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<PersistedState | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get("current");
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(state: PersistedState): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(state, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

function loadSync(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return JSON.parse(raw);
  } catch {
    return DEFAULTS;
  }
}

function persistSync(state: PersistedState): void {
  try {
    if (state.mode === "image") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, imageDataUrl: "" }));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch { /* ignore */ }
  idbSet(state);
}

export const useDesktopBackgroundStore = create<DesktopBackgroundState>()((set) => ({
  ...loadSync(),

  setColor: (color) => {
    const next: PersistedState = { mode: "color", color, imageDataUrl: "" };
    persistSync(next);
    set(next);
  },

  setImage: (dataUrl) => {
    const next: PersistedState = { mode: "image", color: "", imageDataUrl: dataUrl };
    persistSync(next);
    set(next);
  },

  clearBackground: () => {
    persistSync(DEFAULTS);
    set(DEFAULTS);
  },
}));

idbGet().then((saved) => {
  if (!saved) return;
  const current = useDesktopBackgroundStore.getState();
  if (saved.mode === "image" && saved.imageDataUrl && !current.imageDataUrl) {
    useDesktopBackgroundStore.setState(saved);
  }
});
