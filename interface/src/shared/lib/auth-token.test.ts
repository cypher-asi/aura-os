import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  const localStorageStub = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
    key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
    get length() {
      return storage.size;
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: localStorageStub,
    });
  }
});
import {
  authHeaders,
  clearStoredAuth,
  endLocalSession,
  getStoredJwt,
  getStoredSession,
  hydrateStoredAuth,
  isLoggedInSync,
  setStoredAuth,
} from "./auth-token";

beforeEach(async () => {
  window.localStorage.removeItem("aura-jwt");
  window.localStorage.removeItem("aura-session");
  window.localStorage.removeItem("aura-idb:auth:session");
  window.localStorage.removeItem("aura-force-logged-out");
  await clearStoredAuth();
});

const mockSession = {
  user_id: "u1",
  display_name: "Test",
  profile_image: "",
  primary_zid: "0://test",
  zero_wallet: "0x0",
  wallets: ["0x0"],
  access_token: "my-jwt-token",
  created_at: "2026-01-01T00:00:00Z",
  validated_at: "2026-01-01T00:00:00Z",
};

describe("auth-token", () => {
  it("getStoredJwt returns null when empty", () => {
    expect(getStoredJwt()).toBeNull();
  });

  it("getStoredSession returns null when empty", () => {
    expect(getStoredSession()).toBeNull();
  });

  it("setStoredAuth stores jwt and session", async () => {
    await setStoredAuth(mockSession);
    expect(getStoredJwt()).toBe("my-jwt-token");
    expect(getStoredSession()).toEqual(mockSession);
  });

  it("clearStoredAuth removes both keys", async () => {
    await setStoredAuth(mockSession);
    await clearStoredAuth();
    expect(getStoredJwt()).toBeNull();
    expect(getStoredSession()).toBeNull();
  });

  it("setStoredAuth with null clears storage", async () => {
    await setStoredAuth(mockSession);
    await setStoredAuth(null);
    expect(getStoredJwt()).toBeNull();
    expect(getStoredSession()).toBeNull();
  });

  it("setStoredAuth with missing access_token clears storage", async () => {
    await setStoredAuth(mockSession);
    await setStoredAuth({ ...mockSession, access_token: undefined });
    expect(getStoredJwt()).toBeNull();
  });

  it("authHeaders returns empty object when no jwt", () => {
    expect(authHeaders()).toEqual({});
  });

  it("authHeaders returns Authorization header when jwt stored", async () => {
    await setStoredAuth(mockSession);
    expect(authHeaders()).toEqual({ Authorization: "Bearer my-jwt-token" });
  });

  it("hydrates legacy localStorage auth into the runtime cache", async () => {
    window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
    window.localStorage.setItem("aura-jwt", mockSession.access_token);
    await hydrateStoredAuth();
    expect(getStoredJwt()).toBe("my-jwt-token");
    expect(getStoredSession()).toEqual(mockSession);
  });

  it("hydrates the browser-db localStorage fallback when aura-session is missing", async () => {
    window.localStorage.setItem("aura-idb:auth:session", JSON.stringify(mockSession));
    window.localStorage.setItem("aura-jwt", mockSession.access_token);
    await hydrateStoredAuth();
    expect(getStoredJwt()).toBe("my-jwt-token");
    expect(getStoredSession()).toEqual(mockSession);
  });

  it("getStoredSession returns null for invalid JSON", async () => {
    window.localStorage.setItem("aura-session", "not-json");
    await hydrateStoredAuth();
    expect(getStoredSession()).toBeNull();
  });

  describe("isLoggedInSync", () => {
    it("returns false when nothing is stored", () => {
      expect(isLoggedInSync()).toBe(false);
    });

    it("returns true after setStoredAuth writes a session with a token", async () => {
      await setStoredAuth(mockSession);
      expect(isLoggedInSync()).toBe(true);
    });

    it("returns false after clearStoredAuth", async () => {
      await setStoredAuth(mockSession);
      await clearStoredAuth();
      expect(isLoggedInSync()).toBe(false);
    });

    it("returns false when stored session has no access_token", async () => {
      await setStoredAuth(mockSession);
      await setStoredAuth({ ...mockSession, access_token: undefined });
      expect(isLoggedInSync()).toBe(false);
    });

    it("returns true after hydrating from the legacy localStorage mirror", async () => {
      window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
      window.localStorage.setItem("aura-jwt", mockSession.access_token);
      await hydrateStoredAuth();
      expect(isLoggedInSync()).toBe(true);
    });
  });

  describe("force-logged-out sentinel", () => {
    it("endLocalSession arms the sentinel; plain clearStoredAuth does not", async () => {
      await setStoredAuth(mockSession);

      await clearStoredAuth();
      expect(window.localStorage.getItem("aura-force-logged-out")).toBeNull();

      await setStoredAuth(mockSession);
      await endLocalSession();
      expect(window.localStorage.getItem("aura-force-logged-out")).toBe("1");
    });

    it("endLocalSession wipes the browser-db localStorage fallback mirror too", async () => {
      window.localStorage.setItem(
        "aura-idb:auth:session",
        JSON.stringify(mockSession),
      );
      await endLocalSession();
      expect(window.localStorage.getItem("aura-idb:auth:session")).toBeNull();
    });

    it("setStoredAuth clears the sentinel when a real session is persisted", async () => {
      window.localStorage.setItem("aura-force-logged-out", "1");
      await setStoredAuth(mockSession);
      expect(window.localStorage.getItem("aura-force-logged-out")).toBeNull();
    });

    it("hydrateStoredAuth honours the sentinel and wipes stale local mirrors", async () => {
      window.localStorage.setItem("aura-force-logged-out", "1");
      window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
      window.localStorage.setItem("aura-jwt", mockSession.access_token);

      const result = await hydrateStoredAuth();

      expect(result).toBeNull();
      expect(getStoredSession()).toBeNull();
      expect(window.localStorage.getItem("aura-session")).toBeNull();
      expect(window.localStorage.getItem("aura-jwt")).toBeNull();
    });
  });
});

describe("auth-token boot-injected global", () => {
  // These exercise the module-load seed in `seedCachedSessionFromBoot()`.
  // Because that seed runs at import time we re-import the module fresh for
  // each case after mutating `window.__AURA_BOOT_AUTH__`.

  const BOOT_AUTH_KEY = "__AURA_BOOT_AUTH__";
  type WindowWithBoot = Window & { __AURA_BOOT_AUTH__?: unknown };

  function setBootGlobal(value: unknown): void {
    (window as WindowWithBoot)[BOOT_AUTH_KEY] = value;
  }

  function clearBootGlobal(): void {
    delete (window as WindowWithBoot)[BOOT_AUTH_KEY];
  }

  beforeEach(() => {
    clearBootGlobal();
    window.localStorage.removeItem("aura-jwt");
    window.localStorage.removeItem("aura-session");
    window.localStorage.removeItem("aura-idb:auth:session");
    window.localStorage.removeItem("aura-force-logged-out");
    vi.resetModules();
  });

  it("seeds the cached session from the injected global when isLoggedIn is true", async () => {
    setBootGlobal({
      isLoggedIn: true,
      session: { ...mockSession },
      jwt: mockSession.access_token,
    });

    const mod = await import("./auth-token");
    expect(mod.isLoggedInSync()).toBe(true);
    expect(mod.getStoredSession()).toEqual(mockSession);
    expect(mod.getBootAuthSource()).toBe("injected");
  });

  it("reports not logged in when injected global says isLoggedIn is false, even with localStorage data", async () => {
    window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
    window.localStorage.setItem("aura-jwt", mockSession.access_token);
    setBootGlobal({ isLoggedIn: false, session: null, jwt: null });

    const mod = await import("./auth-token");
    expect(mod.isLoggedInSync()).toBe(false);
    expect(mod.getStoredSession()).toBeNull();
    expect(mod.getBootAuthSource()).toBe("injected");
  });

  it("falls back to localStorage when no injected global is present", async () => {
    window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
    window.localStorage.setItem("aura-jwt", mockSession.access_token);

    const mod = await import("./auth-token");
    expect(mod.isLoggedInSync()).toBe(true);
    expect(mod.getStoredSession()).toEqual(mockSession);
    expect(mod.getBootAuthSource()).toBe("localStorage");
  });

  it("reports source 'none' when neither global nor localStorage has a session", async () => {
    const mod = await import("./auth-token");
    expect(mod.isLoggedInSync()).toBe(false);
    expect(mod.getBootAuthSource()).toBe("none");
  });

  it("backfills access_token from the injected jwt when the injected session is missing one", async () => {
    const sessionWithoutToken = { ...mockSession, access_token: undefined };
    setBootGlobal({
      isLoggedIn: true,
      session: sessionWithoutToken,
      jwt: "token-from-jwt-field",
    });

    const mod = await import("./auth-token");
    expect(mod.isLoggedInSync()).toBe(true);
    expect(mod.getStoredJwt()).toBe("token-from-jwt-field");
  });

  it("ignores malformed global values", async () => {
    setBootGlobal({ isLoggedIn: "yes", session: null });

    const mod = await import("./auth-token");
    expect(mod.getBootAuthSource()).toBe("none");
    expect(mod.isLoggedInSync()).toBe(false);
  });

  it("force-logged-out sentinel overrides a logged-in injected global and purges stale mirrors", async () => {
    // Simulate a post-logout reload: the desktop init script has re-written
    // its startup-baked auth literals into localStorage AND re-defined the
    // boot-auth global as logged-in, but the frontend previously armed the
    // sentinel. The seed must ignore both sources and come up logged out.
    window.localStorage.setItem("aura-force-logged-out", "1");
    window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
    window.localStorage.setItem("aura-jwt", mockSession.access_token);
    setBootGlobal({
      isLoggedIn: true,
      session: { ...mockSession },
      jwt: mockSession.access_token,
    });

    const mod = await import("./auth-token");
    expect(mod.isLoggedInSync()).toBe(false);
    expect(mod.getStoredSession()).toBeNull();
    expect(mod.getBootAuthSource()).toBe("none");
    expect(window.localStorage.getItem("aura-session")).toBeNull();
    expect(window.localStorage.getItem("aura-jwt")).toBeNull();
  });
});
