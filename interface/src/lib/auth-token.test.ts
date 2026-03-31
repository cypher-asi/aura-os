import { describe, it, expect, beforeEach } from "vitest";
import { getStoredJwt, getStoredSession, setStoredAuth, clearStoredAuth, authHeaders } from "./auth-token";

beforeEach(() => {
  window.localStorage.removeItem("aura-jwt");
  window.localStorage.removeItem("aura-session");
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

  it("setStoredAuth stores jwt and session", () => {
    setStoredAuth(mockSession);
    expect(getStoredJwt()).toBe("my-jwt-token");
    expect(getStoredSession()).toEqual(mockSession);
  });

  it("clearStoredAuth removes both keys", () => {
    setStoredAuth(mockSession);
    clearStoredAuth();
    expect(getStoredJwt()).toBeNull();
    expect(getStoredSession()).toBeNull();
  });

  it("setStoredAuth with null clears storage", () => {
    setStoredAuth(mockSession);
    setStoredAuth(null);
    expect(getStoredJwt()).toBeNull();
    expect(getStoredSession()).toBeNull();
  });

  it("setStoredAuth with missing access_token clears storage", () => {
    setStoredAuth(mockSession);
    setStoredAuth({ ...mockSession, access_token: undefined });
    expect(getStoredJwt()).toBeNull();
  });

  it("authHeaders returns empty object when no jwt", () => {
    expect(authHeaders()).toEqual({});
  });

  it("authHeaders returns Authorization header when jwt stored", () => {
    setStoredAuth(mockSession);
    expect(authHeaders()).toEqual({ Authorization: "Bearer my-jwt-token" });
  });

  it("getStoredSession returns null for invalid JSON", () => {
    window.localStorage.setItem("aura-session", "not-json");
    expect(getStoredSession()).toBeNull();
  });
});
