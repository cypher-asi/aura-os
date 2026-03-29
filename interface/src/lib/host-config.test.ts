import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageState = new Map<string, string>();

const mockStorage = {
  getItem: vi.fn((key: string) => storageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storageState.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    storageState.delete(key);
  }),
};

function setLocation(url: string) {
  window.history.replaceState({}, "", url);
}

function clearHostStorage() {
  storageState.clear();
  mockStorage.getItem.mockClear();
  mockStorage.setItem.mockClear();
  mockStorage.removeItem.mockClear();
}

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

describe("host-config", () => {
  beforeEach(() => {
    vi.resetModules();
    clearHostStorage();
    vi.unstubAllEnvs();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: mockStorage,
    });
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
    setLocation("/login");
  });

  afterEach(() => {
    vi.resetModules();
    clearHostStorage();
    vi.unstubAllEnvs();
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
    setLocation("/login");
  });

  it("keeps browser fallbacks on the current origin when no host is configured", async () => {
    const hostConfig = await import("./host-config");

    expect(hostConfig.requiresExplicitHostOrigin()).toBe(false);
    expect(hostConfig.getTargetHostOrigin()).toBeNull();
    expect(hostConfig.getResolvedHostOrigin()).toBe(window.location.origin);
    expect(hostConfig.resolveApiUrl("/api/auth/session")).toBe("/api/auth/session");
  });

  it("uses the Android build default host for native shells when no custom host is set", async () => {
    vi.stubEnv("VITE_ANDROID_DEFAULT_HOST", "http://10.0.2.2:3100");
    (window as Window & { Capacitor?: { isNativePlatform: () => boolean; getPlatform: () => string } }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
    };

    const hostConfig = await import("./host-config");

    expect(hostConfig.requiresExplicitHostOrigin()).toBe(true);
    expect(hostConfig.getNativeDefaultHostOrigin()).toBe("http://10.0.2.2:3100");
    expect(hostConfig.getTargetHostOrigin()).toBe("http://10.0.2.2:3100");
    expect(hostConfig.getResolvedHostOrigin()).toBe("http://10.0.2.2:3100");
    expect(hostConfig.resolveApiUrl("/api/auth/session")).toBe("http://10.0.2.2:3100/api/auth/session");
  });

  it("falls back to the user agent when a native bridge omits the platform helper", async () => {
    vi.stubEnv("VITE_ANDROID_DEFAULT_HOST", "http://10.0.2.2:3100");
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 3a)");
    (window as Window & { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };

    const hostConfig = await import("./host-config");

    expect(hostConfig.getNativeDefaultHostOrigin()).toBe("http://10.0.2.2:3100");
    expect(hostConfig.getTargetHostOrigin()).toBe("http://10.0.2.2:3100");
  });

  it("prefers a user-configured host over the native build default", async () => {
    vi.stubEnv("VITE_IOS_DEFAULT_HOST", "http://127.0.0.1:3100");
    (window as Window & { Capacitor?: { isNativePlatform: () => boolean; getPlatform: () => string } }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => "ios",
    };

    const hostConfig = await import("./host-config");
    hostConfig.setConfiguredHostOrigin("https://api.zero.tech");

    expect(hostConfig.getNativeDefaultHostOrigin()).toBe("http://127.0.0.1:3100");
    expect(hostConfig.getTargetHostOrigin()).toBe("https://api.zero.tech");
    expect(hostConfig.getResolvedHostOrigin()).toBe("https://api.zero.tech");
  });
});
