import { create } from "zustand";

const STORAGE_KEY = "aura:desktopBackground";

interface DesktopBackgroundState {
  mode: "color" | "image" | "none";
  color: string;
  imageDataUrl: string;

  setColor: (color: string) => void;
  setImage: (dataUrl: string) => void;
  clearBackground: () => void;
}

function load(): Pick<DesktopBackgroundState, "mode" | "color" | "imageDataUrl"> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: "none", color: "", imageDataUrl: "" };
    return JSON.parse(raw);
  } catch {
    return { mode: "none", color: "", imageDataUrl: "" };
  }
}

function persist(state: Pick<DesktopBackgroundState, "mode" | "color" | "imageDataUrl">): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore quota errors */ }
}

export const useDesktopBackgroundStore = create<DesktopBackgroundState>()((set) => ({
  ...load(),

  setColor: (color) => {
    const next = { mode: "color" as const, color, imageDataUrl: "" };
    persist(next);
    set(next);
  },

  setImage: (dataUrl) => {
    const next = { mode: "image" as const, color: "", imageDataUrl: dataUrl };
    persist(next);
    set(next);
  },

  clearBackground: () => {
    const next = { mode: "none" as const, color: "", imageDataUrl: "" };
    persist(next);
    set(next);
  },
}));
