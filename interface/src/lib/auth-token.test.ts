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
  getStoredJwt,
  getStoredSession,
  hydrateStoredAuth,
  setStoredAuth,
} from "./auth-token";

beforeEach(async () => {
  window.localStorage.removeItem("aura-jwt");
  window.localStorage.removeItem("aura-session");
  window.localStorage.removeItem("aura-idb:auth:session");
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
});
