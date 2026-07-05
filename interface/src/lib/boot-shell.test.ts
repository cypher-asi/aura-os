import type { LucideIcon } from "lucide-react";
import type { AuraApp } from "../apps/types";
import {
  DEFAULT_INITIAL_APP_READY_TIMEOUT_MS,
  preloadInitialShellApp,
  awaitInitialShellAppReady,
  __resetInitialShellAppReadyForTests,
} from "./boot-shell";

const MockIcon = (() => null) as unknown as LucideIcon;
const MockComponent = () => null;

function makeApp(id: string, basePath: string, preload?: () => Promise<unknown>): AuraApp {
  return {
    id,
    label: id,
    icon: MockIcon,
    basePath,
    LeftPanel: MockComponent,
    MainPanel: MockComponent,
    routes: [],
    preload,
  };
}

describe("preloadInitialShellApp", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    __resetInitialShellAppReadyForTests();
    delete (window as Window & { ipc?: { postMessage: () => void } }).ipc;
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
    });
  });

  afterEach(() => {
    __resetInitialShellAppReadyForTests();
    delete (window as Window & { ipc?: { postMessage: () => void } }).ipc;
    vi.unstubAllGlobals();
  });

  it("invokes preload() on the web entry app even when a last app is remembered", async () => {
    store["aura-last-app"] = "projects";
    const chatPreload = vi.fn(() => Promise.resolve({}));
    const projectsPreload = vi.fn(() => Promise.resolve({}));

    await preloadInitialShellApp({
      appList: [makeApp("chat", "/chat", chatPreload), makeApp("projects", "/projects", projectsPreload)],
      timeoutMs: 0,
    });

    expect(chatPreload).toHaveBeenCalledTimes(1);
    expect(projectsPreload).not.toHaveBeenCalled();
  });

  it("invokes preload() on the desktop entry app when the bridge is present", async () => {
    store["aura-last-app"] = "chat";
    (window as Window & { ipc?: { postMessage: () => void } }).ipc = {
      postMessage: vi.fn(),
    };
    const chatPreload = vi.fn(() => Promise.resolve({}));
    const projectsPreload = vi.fn(() => Promise.resolve({}));

    await preloadInitialShellApp({
      appList: [makeApp("chat", "/chat", chatPreload), makeApp("projects", "/projects", projectsPreload)],
      timeoutMs: 0,
    });

    expect(projectsPreload).toHaveBeenCalledTimes(1);
    expect(chatPreload).not.toHaveBeenCalled();
  });

  it("falls back to the default app when no last-used app is remembered", async () => {
    const chatPreload = vi.fn(() => Promise.resolve({}));

    await preloadInitialShellApp({
      appList: [makeApp("chat", "/chat", chatPreload)],
      timeoutMs: 0,
    });

    expect(chatPreload).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately when the matched app has no preload()", async () => {
    const promise = preloadInitialShellApp({
      appList: [makeApp("chat", "/chat", undefined)],
      timeoutMs: 0,
    });

    await expect(promise).resolves.toBeUndefined();
  });

  it("is idempotent — repeated calls return the same Promise", async () => {
    const preload = vi.fn(() => Promise.resolve({}));
    const a = preloadInitialShellApp({ appList: [makeApp("chat", "/chat", preload)], timeoutMs: 0 });
    const b = preloadInitialShellApp({ appList: [makeApp("chat", "/chat", preload)], timeoutMs: 0 });

    expect(a).toBe(b);
    await a;
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it("resolves before the safety timeout when preload finishes first", async () => {
    let resolvePreload: (() => void) | null = null;
    const preload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePreload = resolve;
        }),
    );

    const ready = preloadInitialShellApp({
      appList: [makeApp("chat", "/chat", preload)],
      timeoutMs: 10_000,
    });

    resolvePreload?.();
    await expect(ready).resolves.toBeUndefined();
  });

  it("still resolves via the safety timeout when preload() never settles", async () => {
    vi.useFakeTimers();
    try {
      const preload = vi.fn(() => new Promise<void>(() => {}));

      const ready = preloadInitialShellApp({
        appList: [makeApp("chat", "/chat", preload)],
        timeoutMs: 25,
      });

      await vi.advanceTimersByTimeAsync(25);
      await expect(ready).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs preload() rejections while keeping the reveal gate open", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const preload = vi.fn(() => Promise.reject(new Error("chunk load failed")));

    try {
      const ready = preloadInitialShellApp({
        appList: [makeApp("chat", "/chat", preload)],
        timeoutMs: 0,
      });

      await expect(ready).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        "[aura-boot] preload chat failed",
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("exposes the same Promise via awaitInitialShellAppReady()", () => {
    const preload = vi.fn(() => Promise.resolve({}));
    const ready = preloadInitialShellApp({
      appList: [makeApp("chat", "/chat", preload)],
      timeoutMs: 0,
    });
    expect(awaitInitialShellAppReady()).toBe(ready);
  });
});

describe("awaitInitialShellAppReady (pre-preload)", () => {
  beforeEach(() => {
    __resetInitialShellAppReadyForTests();
  });

  it("resolves immediately when preloadInitialShellApp has not been invoked", async () => {
    await expect(awaitInitialShellAppReady()).resolves.toBeUndefined();
  });
});

describe("DEFAULT_INITIAL_APP_READY_TIMEOUT_MS", () => {
  it("is a reasonable cold-start budget", () => {
    expect(DEFAULT_INITIAL_APP_READY_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DEFAULT_INITIAL_APP_READY_TIMEOUT_MS).toBeLessThan(2000);
  });
});
