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

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  mockIdbState.current = null;
  useDesktopBackgroundStore.setState({
    mode: "none",
    color: "",
    imageDataUrl: "",
  });
});

describe("desktop-background-store", () => {
  describe("initial state", () => {
    it("defaults to mode none", () => {
      expect(useDesktopBackgroundStore.getState().mode).toBe("none");
    });

    it("has empty color and imageDataUrl", () => {
      expect(useDesktopBackgroundStore.getState().color).toBe("");
      expect(useDesktopBackgroundStore.getState().imageDataUrl).toBe("");
    });
  });

  describe("setColor", () => {
    it("sets mode to color and stores the color", () => {
      useDesktopBackgroundStore.getState().setColor("#ff0000");
      const s = useDesktopBackgroundStore.getState();
      expect(s.mode).toBe("color");
      expect(s.color).toBe("#ff0000");
      expect(s.imageDataUrl).toBe("");
    });

    it("persists color to localStorage", () => {
      useDesktopBackgroundStore.getState().setColor("#00ff00");
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.mode).toBe("color");
      expect(stored.color).toBe("#00ff00");
    });
  });

  describe("setImage", () => {
    it("sets mode to image with dataUrl", () => {
      useDesktopBackgroundStore.getState().setImage("data:image/png;base64,abc");
      const s = useDesktopBackgroundStore.getState();
      expect(s.mode).toBe("image");
      expect(s.imageDataUrl).toBe("data:image/png;base64,abc");
      expect(s.color).toBe("");
    });

    it("persists to localStorage without the full image data", () => {
      useDesktopBackgroundStore.getState().setImage("data:image/png;base64,abc");
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.mode).toBe("image");
      expect(stored.imageDataUrl).toBe("");
    });
  });

  describe("clearBackground", () => {
    it("resets to defaults", () => {
      useDesktopBackgroundStore.getState().setColor("#ff0000");
      useDesktopBackgroundStore.getState().clearBackground();
      const s = useDesktopBackgroundStore.getState();
      expect(s.mode).toBe("none");
      expect(s.color).toBe("");
      expect(s.imageDataUrl).toBe("");
    });

    it("persists cleared state", () => {
      useDesktopBackgroundStore.getState().setColor("#ff0000");
      useDesktopBackgroundStore.getState().clearBackground();
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored.mode).toBe("none");
    });
  });
});
