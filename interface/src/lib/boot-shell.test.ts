import type { LucideIcon } from "lucide-react";
import type { AuraApp } from "../apps/types";
import {
  DEFAULT_INITIAL_APP_READY_TIMEOUT_MS,
  preloadInitialShellApp,
  awaitInitialShellAppReady,
  __resetInitialShellAppReadyForTests,
} from "./boot-shell";
import { LAST_APP_KEY } from "../constants";

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
    vi.unstubAllGlobals();
  });

  it("invokes preload() on the app matching the last-used-app base path", async () => {
    store[LAST_APP_KEY] = "projects";

    const projectsPreload = vi.fn(() => Promise.resolve({}));
    const agentsPreload = vi.fn(() => Promise.resolve({}));

    await preloadInitialShellApp({
      appList: [makeApp("agents", "/agents", agentsPreload), makeApp("projects", "/projects", projectsPreload)],
      timeoutMs: 0,
    });

    expect(projectsPreload).toHaveBeenCalledTimes(1);
    expect(agentsPreload).not.toHaveBeenCalled();
  });

  it("falls back to the default app when no last-used app is remembered", async () => {
    const agentsPreload = vi.fn(() => Promise.resolve({}));

    await preloadInitialShellApp({
      appList: [makeApp("agents", "/agents", agentsPreload)],
      timeoutMs: 0,
    });

    expect(agentsPreload).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately when the matched app has no preload()", async () => {
    store[LAST_APP_KEY] = "projects";

    const promise = preloadInitialShellApp({
      appList: [makeApp("projects", "/projects", undefined)],
      timeoutMs: 0,
    });

    await expect(promise).resolves.toBeUndefined();
  });

  it("is idempotent — repeated calls return the same Promise", async () => {
    const preload = vi.fn(() => Promise.resolve({}));
    const a = preloadInitialShellApp({ appList: [makeApp("agents", "/agents", preload)], timeoutMs: 0 });
    const b = preloadInitialShellApp({ appList: [makeApp("agents", "/agents", preload)], timeoutMs: 0 });

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
      appList: [makeApp("agents", "/agents", preload)],
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
        appList: [makeApp("agents", "/agents", preload)],
        timeoutMs: 25,
      });

      await vi.advanceTimersByTimeAsync(25);
      await expect(ready).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("swallows preload() rejections so the reveal gate can still open", async () => {
    const preload = vi.fn(() => Promise.reject(new Error("chunk load failed")));

    const ready = preloadInitialShellApp({
      appList: [makeApp("agents", "/agents", preload)],
      timeoutMs: 0,
    });

    await expect(ready).resolves.toBeUndefined();
  });

  it("exposes the same Promise via awaitInitialShellAppReady()", () => {
    const preload = vi.fn(() => Promise.resolve({}));
    const ready = preloadInitialShellApp({
      appList: [makeApp("agents", "/agents", preload)],
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
