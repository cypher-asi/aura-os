import { clearNativeServiceWorkerCachesForRuntime, registerServiceWorkerForRuntime } from "./registerServiceWorker";

function createSessionStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("registerServiceWorker", () => {
  it("clears native registrations and reloads once when stale workers exist", async () => {
    const unregister = vi.fn(async () => true);
    const getRegistrations = vi.fn(async () => [{ unregister }]);
    const deleteCache = vi.fn(async () => true);
    const runtimeWindow = {
      addEventListener: vi.fn(),
      sessionStorage: createSessionStorage(),
      location: { reload: vi.fn() },
      caches: {
        keys: vi.fn(async () => ["aura-cache"]),
        delete: deleteCache,
      },
    };

    await clearNativeServiceWorkerCachesForRuntime(runtimeWindow, {
      serviceWorker: {
        getRegistrations,
        register: vi.fn(),
      },
    });

    expect(getRegistrations).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("aura-cache");
    expect(runtimeWindow.sessionStorage.getItem("aura-native-sw-reset")).toBe("1");
    expect(runtimeWindow.location.reload).toHaveBeenCalledOnce();
  });

  it("removes the reset key after the follow-up native launch", async () => {
    const runtimeWindow = {
      addEventListener: vi.fn(),
      sessionStorage: createSessionStorage({ "aura-native-sw-reset": "1" }),
      location: { reload: vi.fn() },
      caches: {
        keys: vi.fn(async () => []),
        delete: vi.fn(),
      },
    };

    await clearNativeServiceWorkerCachesForRuntime(runtimeWindow, {
      serviceWorker: {
        getRegistrations: vi.fn(async () => []),
        register: vi.fn(),
      },
    });

    expect(runtimeWindow.sessionStorage.getItem("aura-native-sw-reset")).toBeNull();
    expect(runtimeWindow.location.reload).not.toHaveBeenCalled();
  });

  it("registers the web service worker on non-native production loads", async () => {
    let onLoad: (() => void) | null = null;
    const register = vi.fn(async () => undefined);

    registerServiceWorkerForRuntime({
      isProd: true,
      nativeRuntime: false,
      runtimeWindow: {
        addEventListener: vi.fn((event: string, listener: () => void) => {
          if (event === "load") {
            onLoad = listener;
          }
        }),
        sessionStorage: createSessionStorage(),
        location: { reload: vi.fn() },
      },
      runtimeNavigator: {
        serviceWorker: {
          getRegistrations: vi.fn(async () => []),
          register,
        },
      },
    });

    expect(onLoad).not.toBeNull();
    await onLoad?.();

    expect(register).toHaveBeenCalledWith("/sw.js");
  });
});
