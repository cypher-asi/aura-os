import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDesktopWindowStore, MIN_WIDTH, MIN_HEIGHT } from "./desktop-window-store";

const STORAGE_KEY = "aura:desktopWindows";
const DEFAULT_HEIGHT = 520;

function mountWindowLayerHost(height = 700) {
  const host = document.createElement("div");
  host.setAttribute("data-window-layer-host", "true");
  host.getBoundingClientRect = vi.fn(() => ({
    width: 1200,
    height,
    top: 0,
    right: 1200,
    bottom: height,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })) as unknown as typeof host.getBoundingClientRect;
  document.body.appendChild(host);
  return host;
}

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  document.body.innerHTML = "";
  useDesktopWindowStore.setState({ windows: {}, nextZ: 1 });
  vi.clearAllMocks();
});

describe("desktop-window-store", () => {
  describe("initial state", () => {
    it("starts with no windows", () => {
      expect(useDesktopWindowStore.getState().windows).toEqual({});
    });

    it("has nextZ of 1", () => {
      expect(useDesktopWindowStore.getState().nextZ).toBe(1);
    });
  });

  describe("openWindow", () => {
    it("adds a new window with default size and bottom-aligned position", () => {
      mountWindowLayerHost(700);
      useDesktopWindowStore.getState().openWindow("agent-1");
      const w = useDesktopWindowStore.getState().windows["agent-1"];
      expect(w).toBeDefined();
      expect(w.agentId).toBe("agent-1");
      expect(w.width).toBe(420);
      expect(w.height).toBe(520);
      expect(w.y).toBe(700 - DEFAULT_HEIGHT);
      expect(w.minimized).toBe(false);
      expect(w.maximized).toBe(false);
    });

    it("increments nextZ", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      expect(useDesktopWindowStore.getState().nextZ).toBe(2);
    });

    it("does not overwrite an already-open window", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      const original = useDesktopWindowStore.getState().windows["agent-1"];
      useDesktopWindowStore.getState().openWindow("agent-1");
      expect(useDesktopWindowStore.getState().windows["agent-1"]).toBe(original);
    });

    it("persists to localStorage", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored["agent-1"]).toBeDefined();
    });

    it("keeps new windows bottom-aligned while staggering horizontally", () => {
      mountWindowLayerHost(760);
      useDesktopWindowStore.getState().openWindow("a1");
      useDesktopWindowStore.getState().openWindow("a2");
      const w1 = useDesktopWindowStore.getState().windows["a1"];
      const w2 = useDesktopWindowStore.getState().windows["a2"];
      expect(w2.x).toBeGreaterThan(w1.x);
      expect(w2.y).toBe(w1.y);
      expect(w1.y + w1.height).toBe(760);
    });
  });

  describe("closeWindow", () => {
    it("removes the window", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().closeWindow("agent-1");
      expect(useDesktopWindowStore.getState().windows["agent-1"]).toBeUndefined();
    });

    it("persists the removal", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().closeWindow("agent-1");
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(stored["agent-1"]).toBeUndefined();
    });
  });

  describe("minimizeWindow", () => {
    it("sets minimized to true", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().minimizeWindow("agent-1");
      expect(useDesktopWindowStore.getState().windows["agent-1"].minimized).toBe(true);
    });

    it("is a no-op for a non-existent window", () => {
      const before = useDesktopWindowStore.getState();
      useDesktopWindowStore.getState().minimizeWindow("no-window");
      expect(useDesktopWindowStore.getState()).toBe(before);
    });
  });

  describe("maximizeWindow", () => {
    it("toggles maximized and unminimizes", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().minimizeWindow("agent-1");
      useDesktopWindowStore.getState().maximizeWindow("agent-1");
      const w = useDesktopWindowStore.getState().windows["agent-1"];
      expect(w.maximized).toBe(true);
      expect(w.minimized).toBe(false);
    });

    it("toggles maximized off when already maximized", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().maximizeWindow("agent-1");
      useDesktopWindowStore.getState().maximizeWindow("agent-1");
      expect(useDesktopWindowStore.getState().windows["agent-1"].maximized).toBe(false);
    });

    it("bumps zIndex", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      const zBefore = useDesktopWindowStore.getState().windows["agent-1"].zIndex;
      useDesktopWindowStore.getState().maximizeWindow("agent-1");
      expect(useDesktopWindowStore.getState().windows["agent-1"].zIndex).toBeGreaterThan(zBefore);
    });
  });

  describe("restoreWindow", () => {
    it("un-minimizes and bumps zIndex", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().minimizeWindow("agent-1");
      const zBefore = useDesktopWindowStore.getState().windows["agent-1"].zIndex;
      useDesktopWindowStore.getState().restoreWindow("agent-1");
      const w = useDesktopWindowStore.getState().windows["agent-1"];
      expect(w.minimized).toBe(false);
      expect(w.zIndex).toBeGreaterThan(zBefore);
    });
  });

  describe("focusWindow", () => {
    it("bumps zIndex for the focused window", () => {
      useDesktopWindowStore.getState().openWindow("a1");
      useDesktopWindowStore.getState().openWindow("a2");
      const zBefore = useDesktopWindowStore.getState().windows["a1"].zIndex;
      useDesktopWindowStore.getState().focusWindow("a1");
      expect(useDesktopWindowStore.getState().windows["a1"].zIndex).toBeGreaterThan(zBefore);
    });

    it("is a no-op for a non-existent window", () => {
      const before = useDesktopWindowStore.getState();
      useDesktopWindowStore.getState().focusWindow("no-window");
      expect(useDesktopWindowStore.getState()).toBe(before);
    });
  });

  describe("moveWindow", () => {
    it("updates x and y", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().moveWindow("agent-1", 200, 300);
      const w = useDesktopWindowStore.getState().windows["agent-1"];
      expect(w.x).toBe(200);
      expect(w.y).toBe(300);
    });
  });

  describe("resizeWindow", () => {
    it("updates width and height", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().resizeWindow("agent-1", 800, 600);
      const w = useDesktopWindowStore.getState().windows["agent-1"];
      expect(w.width).toBe(800);
      expect(w.height).toBe(600);
    });

    it("clamps to minimum dimensions", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().resizeWindow("agent-1", 10, 10);
      const w = useDesktopWindowStore.getState().windows["agent-1"];
      expect(w.width).toBe(MIN_WIDTH);
      expect(w.height).toBe(MIN_HEIGHT);
    });
  });

  describe("setWindowRect", () => {
    it("sets position and clamped size", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().setWindowRect("agent-1", 50, 60, 500, 400);
      const w = useDesktopWindowStore.getState().windows["agent-1"];
      expect(w.x).toBe(50);
      expect(w.y).toBe(60);
      expect(w.width).toBe(500);
      expect(w.height).toBe(400);
    });

    it("clamps y to non-negative", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().setWindowRect("agent-1", 10, -50, 500, 400);
      expect(useDesktopWindowStore.getState().windows["agent-1"].y).toBe(0);
    });

    it("clamps width and height to minimums", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().setWindowRect("agent-1", 0, 0, 10, 10);
      const w = useDesktopWindowStore.getState().windows["agent-1"];
      expect(w.width).toBe(MIN_WIDTH);
      expect(w.height).toBe(MIN_HEIGHT);
    });

    it("is a no-op when rect has not changed", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().setWindowRect("agent-1", 100, 100, 500, 400);
      const before = useDesktopWindowStore.getState();
      useDesktopWindowStore.getState().setWindowRect("agent-1", 100, 100, 500, 400);
      expect(useDesktopWindowStore.getState()).toBe(before);
    });
  });

  describe("openOrFocus", () => {
    it("opens a new window if not already open", () => {
      useDesktopWindowStore.getState().openOrFocus("agent-1");
      expect(useDesktopWindowStore.getState().windows["agent-1"]).toBeDefined();
    });

    it("restores a minimized window", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      useDesktopWindowStore.getState().minimizeWindow("agent-1");
      useDesktopWindowStore.getState().openOrFocus("agent-1");
      expect(useDesktopWindowStore.getState().windows["agent-1"].minimized).toBe(false);
    });

    it("focuses an already-visible window", () => {
      useDesktopWindowStore.getState().openWindow("a1");
      useDesktopWindowStore.getState().openWindow("a2");
      const zBefore = useDesktopWindowStore.getState().windows["a1"].zIndex;
      useDesktopWindowStore.getState().openOrFocus("a1");
      expect(useDesktopWindowStore.getState().windows["a1"].zIndex).toBeGreaterThan(zBefore);
    });
  });

  describe("isOpen", () => {
    it("returns false for a non-existent window", () => {
      expect(useDesktopWindowStore.getState().isOpen("nope")).toBe(false);
    });

    it("returns true for an open window", () => {
      useDesktopWindowStore.getState().openWindow("agent-1");
      expect(useDesktopWindowStore.getState().isOpen("agent-1")).toBe(true);
    });
  });
});
