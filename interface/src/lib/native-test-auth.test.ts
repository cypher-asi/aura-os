import { beforeEach, describe, expect, it, vi } from "vitest";

const getStoredSession = vi.fn();
const setStoredAuth = vi.fn();
const resolveApiUrl = vi.fn((path: string) => `http://127.0.0.1:3100${path}`);
const isNativeRuntime = vi.fn();

vi.mock("./auth-token", () => ({
  getStoredSession,
  setStoredAuth,
}));

vi.mock("./host-config", () => ({
  resolveApiUrl,
}));

vi.mock("./native-runtime", () => ({
  isNativeRuntime,
}));

describe("bootstrapNativeTestAuth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_NATIVE_TEST_ACCESS_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());
    getStoredSession.mockReset();
    setStoredAuth.mockReset();
    resolveApiUrl.mockClear();
    isNativeRuntime.mockReset();
    isNativeRuntime.mockReturnValue(false);
  });

  it("does nothing when native test auth is disabled", async () => {
    const { bootstrapNativeTestAuth } = await import("./native-test-auth");

    await expect(bootstrapNativeTestAuth()).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(setStoredAuth).not.toHaveBeenCalled();
  });

  it("imports and stores a session on native builds with a token", async () => {
    vi.stubEnv("VITE_NATIVE_TEST_ACCESS_TOKEN", "token-123");
    isNativeRuntime.mockReturnValue(true);
    getStoredSession.mockReturnValue(null);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ access_token: "jwt-1", user_id: "u1" }),
    }));

    const { bootstrapNativeTestAuth } = await import("./native-test-auth");

    await expect(bootstrapNativeTestAuth()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/api/auth/import-access-token",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(setStoredAuth).toHaveBeenCalledWith({ access_token: "jwt-1", user_id: "u1" });
  });

  it("skips import when a stored session already exists", async () => {
    vi.stubEnv("VITE_NATIVE_TEST_ACCESS_TOKEN", "token-123");
    isNativeRuntime.mockReturnValue(true);
    getStoredSession.mockReturnValue({ access_token: "existing-jwt" });

    const { bootstrapNativeTestAuth } = await import("./native-test-auth");

    await expect(bootstrapNativeTestAuth()).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
