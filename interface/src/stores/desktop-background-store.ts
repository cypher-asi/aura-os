import { create } from "zustand";

const STORAGE_KEY = "aura:desktopBackground";
const DB_NAME = "aura-desktop-bg";
const DB_STORE = "background";

export type ThemeSlot = "light" | "dark";

export interface BackgroundConfig {
  mode: "color" | "image" | "none";
  color: string;
  imageDataUrl: string;
}

interface PersistedState {
  light: BackgroundConfig;
  dark: BackgroundConfig;
}

interface DesktopBackgroundState extends PersistedState {
  hydrated: boolean;
  setColor: (theme: ThemeSlot, color: string) => void;
  setImage: (theme: ThemeSlot, dataUrl: string) => void;
  clearBackground: (theme: ThemeSlot) => void;
}

const NONE: BackgroundConfig = { mode: "none", color: "", imageDataUrl: "" };

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

async function idbGet(): Promise<unknown> {
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

function isLegacyShape(value: unknown): value is BackgroundConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "mode" in value &&
    typeof (value as { mode: unknown }).mode === "string"
  );
}

function isPersistedState(value: unknown): value is PersistedState {
  return (
    typeof value === "object" &&
    value !== null &&
    "light" in value &&
    "dark" in value
  );
}

function normalizeConfig(value: unknown): BackgroundConfig {
  if (typeof value !== "object" || value === null) return { ...NONE };
  const v = value as Partial<BackgroundConfig>;
  const mode: BackgroundConfig["mode"] =
    v.mode === "color" || v.mode === "image" || v.mode === "none" ? v.mode : "none";
  return {
    mode,
    color: typeof v.color === "string" ? v.color : "",
    imageDataUrl: typeof v.imageDataUrl === "string" ? v.imageDataUrl : "",
  };
}

function migrate(value: unknown): PersistedState {
  if (isPersistedState(value)) {
    return {
      light: normalizeConfig((value as PersistedState).light),
      dark: normalizeConfig((value as PersistedState).dark),
    };
  }
  if (isLegacyShape(value)) {
    const cfg = normalizeConfig(value);
    return { light: { ...cfg }, dark: { ...cfg } };
  }
  return { light: { ...NONE }, dark: { ...NONE } };
}

function loadSync(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { light: { ...NONE }, dark: { ...NONE } };
    return migrate(JSON.parse(raw));
  } catch {
    return { light: { ...NONE }, dark: { ...NONE } };
  }
}

function stripImageDataUrl(cfg: BackgroundConfig): BackgroundConfig {
  return cfg.mode === "image" ? { ...cfg, imageDataUrl: "" } : cfg;
}

function persistSync(state: PersistedState): void {
  try {
    const stripped: PersistedState = {
      light: stripImageDataUrl(state.light),
      dark: stripImageDataUrl(state.dark),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
  } catch { /* ignore */ }
  idbSet(state);
}

const initialPersisted = loadSync();
const hasImageSlot =
  initialPersisted.light.mode === "image" || initialPersisted.dark.mode === "image";

export const useDesktopBackgroundStore = create<DesktopBackgroundState>()((set, get) => ({
  ...initialPersisted,
  hydrated: !hasImageSlot,

  setColor: (theme, color) => {
    const state = get();
    const next: PersistedState = {
      light: state.light,
      dark: state.dark,
      [theme]: { mode: "color", color, imageDataUrl: "" },
    } as PersistedState;
    persistSync(next);
    set({ ...next, hydrated: true });
  },

  setImage: (theme, dataUrl) => {
    const state = get();
    const next: PersistedState = {
      light: state.light,
      dark: state.dark,
      [theme]: { mode: "image", color: "", imageDataUrl: dataUrl },
    } as PersistedState;
    persistSync(next);
    set({ ...next, hydrated: true });
  },

  clearBackground: (theme) => {
    const state = get();
    const next: PersistedState = {
      light: state.light,
      dark: state.dark,
      [theme]: { ...NONE },
    } as PersistedState;
    persistSync(next);
    set({ ...next, hydrated: true });
  },
}));

idbGet().then((saved) => {
  const current = useDesktopBackgroundStore.getState();
  const migrated = migrate(saved);

  const merged: PersistedState = {
    light: { ...current.light },
    dark: { ...current.dark },
  };

  let updated = false;
  for (const slot of ["light", "dark"] as const) {
    if (
      current[slot].mode === "image" &&
      !current[slot].imageDataUrl &&
      migrated[slot].mode === "image" &&
      migrated[slot].imageDataUrl
    ) {
      merged[slot] = migrated[slot];
      updated = true;
    }
  }

  if (updated) {
    useDesktopBackgroundStore.setState({ ...merged, hydrated: true });
    return;
  }
  if (!current.hydrated) {
    useDesktopBackgroundStore.setState({ hydrated: true });
  }
});
