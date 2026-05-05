import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("zustand", async () => {
  const actual = await vi.importActual<typeof import("zustand")>("zustand");
  return actual;
});

const STORAGE_KEY = "aura:desktopBackground";

const mockIdbState = { current: null as Record<string, unknown> | null };

vi.stubGlobal("indexedDB", {
  open: () => {
    const req: Record<string, unknown> = { result: null, error: null };
    const db = {
      createObjectStore: vi.fn(),
      transaction: (_store: string, _mode: string) => {
        const tx: Record<string, unknown> = {
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          objectStore: () => ({
            get: (_key: string) => {
              const getReq: Record<string, unknown> = {
                result: mockIdbState.current,
                onsuccess: null,
                onerror: null,
              };
              setTimeout(() => (getReq.onsuccess as (() => void))?.(), 0);
              return getReq;
            },
            put: (val: unknown, _key: string) => {
              mockIdbState.current = val as Record<string, unknown>;
              setTimeout(() => (tx.oncomplete as (() => void))?.(), 0);
              return {};
            },
          }),
        };
        return tx;
      },
    };
    req.result = db;
    setTimeout(() => (req.onsuccess as (() => void))?.(), 0);
    return req;
  },
});

import { useDesktopBackgroundStore } from "./desktop-background-store";

const NONE = { mode: "none" as const, color: "", imageDataUrl: "" };

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  mockIdbState.current = null;
  useDesktopBackgroundStore.setState({
    light: { ...NONE },
    dark: { ...NONE },
  });
});

describe("desktop-background-store", () => {
  describe("initial state", () => {
    it("defaults both slots to mode none", () => {
      const s = useDesktopBackgroundStore.getState();
      expect(s.light.mode).toBe("none");
      expect(s.dark.mode).toBe("none");
    });

    it("has empty color and imageDataUrl on both slots", () => {
      const s = useDesktopBackgroundStore.getState();
      expect(s.light.color).toBe("");
      expect(s.light.imageDataUrl).toBe("");
      expect(s.dark.color).toBe("");
      expect(s.dark.imageDataUrl).toBe("");
    });
  });

  describe("setColor", () => {
    it("sets color on the requested slot only", () => {
      useDesktopBackgroundStore.getState().setColor("light", "#ff0000");
      const s = useDesktopBackgroundStore.getState();
      expect(s.light.mode).toBe("color");
      expect(s.light.color).toBe("#ff0000");
      expect(s.light.imageDataUrl).toBe("");
      expect(s.dark.mode).toBe("none");
    });

    it("sets dark color independently from light", () => {
      useDesktopBackgroundStore.getState().setColor("light", "#ff0000");
      useDesktopBackgroundStore.getState().setColor("dark", "#00ff00");
      const s = useDesktopBackgroundStore.getState();
      expect(s.light.color).toBe("#ff0000");
      expect(s.dark.color).toBe("#00ff00");
    });

    it("persists both slots to localStorage", () => {
      useDesktopBackgroundStore.getState().setColor("light", "#ff0000");
      useDesktopBackgroundStore.getState().setColor("dark", "#00ff00");
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.light.mode).toBe("color");
      expect(stored.light.color).toBe("#ff0000");
      expect(stored.dark.mode).toBe("color");
      expect(stored.dark.color).toBe("#00ff00");
    });
  });

  describe("setImage", () => {
    it("sets image on the requested slot", () => {
      useDesktopBackgroundStore
        .getState()
        .setImage("dark", "data:image/png;base64,abc");
      const s = useDesktopBackgroundStore.getState();
      expect(s.dark.mode).toBe("image");
      expect(s.dark.imageDataUrl).toBe("data:image/png;base64,abc");
      expect(s.dark.color).toBe("");
      expect(s.light.mode).toBe("none");
    });

    it("strips image data URL from localStorage but keeps other slot intact", () => {
      useDesktopBackgroundStore.getState().setColor("light", "#abcdef");
      useDesktopBackgroundStore
        .getState()
        .setImage("dark", "data:image/png;base64,abc");
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.dark.mode).toBe("image");
      expect(stored.dark.imageDataUrl).toBe("");
      expect(stored.light.mode).toBe("color");
      expect(stored.light.color).toBe("#abcdef");
    });
  });

  describe("clearBackground", () => {
    it("resets only the requested slot", () => {
      useDesktopBackgroundStore.getState().setColor("light", "#ff0000");
      useDesktopBackgroundStore.getState().setColor("dark", "#00ff00");
      useDesktopBackgroundStore.getState().clearBackground("light");
      const s = useDesktopBackgroundStore.getState();
      expect(s.light.mode).toBe("none");
      expect(s.light.color).toBe("");
      expect(s.dark.mode).toBe("color");
      expect(s.dark.color).toBe("#00ff00");
    });

    it("persists cleared state for that slot", () => {
      useDesktopBackgroundStore.getState().setColor("dark", "#ff0000");
      useDesktopBackgroundStore.getState().clearBackground("dark");
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.dark.mode).toBe("none");
    });
  });

  describe("legacy migration", () => {
    it("copies a legacy single-config localStorage value into both slots on import", async () => {
      vi.resetModules();
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mode: "color", color: "#abcabc", imageDataUrl: "" }),
      );
      const mod = await import("./desktop-background-store");
      const s = mod.useDesktopBackgroundStore.getState();
      expect(s.light.mode).toBe("color");
      expect(s.light.color).toBe("#abcabc");
      expect(s.dark.mode).toBe("color");
      expect(s.dark.color).toBe("#abcabc");
    });
  });
});
