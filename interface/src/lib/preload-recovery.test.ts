import { installPreloadRecoveryForRuntime } from "./preload-recovery";

function createSessionStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("installPreloadRecovery", () => {
  it("reloads once after a preload error in production", () => {
    let handler: ((event: Event) => void) | null = null;
    const runtimeWindow = {
      addEventListener: vi.fn((event: string, listener: (event: Event) => void) => {
        if (event === "vite:preloadError") {
          handler = listener;
        }
      }),
      sessionStorage: createSessionStorage(),
      location: { reload: vi.fn() },
    };

    installPreloadRecoveryForRuntime({ isProd: true, runtimeWindow });
    const preventDefault = vi.fn();
    handler?.({ preventDefault } as unknown as Event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(runtimeWindow.sessionStorage.getItem("aura-preload-recovery")).toBe("1");
    expect(runtimeWindow.location.reload).toHaveBeenCalledOnce();
  });

  it("does not reload again after recovery has already been attempted", () => {
    let handler: ((event: Event) => void) | null = null;
    const runtimeWindow = {
      addEventListener: vi.fn((event: string, listener: (event: Event) => void) => {
        if (event === "vite:preloadError") {
          handler = listener;
        }
      }),
      sessionStorage: createSessionStorage({ "aura-preload-recovery": "1" }),
      location: { reload: vi.fn() },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    installPreloadRecoveryForRuntime({ isProd: true, runtimeWindow });
    handler?.({ preventDefault: vi.fn() } as unknown as Event);

    expect(runtimeWindow.location.reload).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
