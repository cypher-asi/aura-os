import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { authApi } from "./auth";
import { ApiClientError } from "./core";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: { get: (k: string) => k.toLowerCase() === "content-type" ? "application/json" : null },
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

describe("authApi", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("login sends POST with email and password", async () => {
    const session = { token: "abc", user_id: "u1" };
    const fetchMock = mockFetch(200, session);
    globalThis.fetch = fetchMock;
    const result = await authApi.login("a@b.com", "pass123");
    expect(result).toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "pass123" }),
      }),
    );
  });

  it("register sends POST with email and password", async () => {
    const fetchMock = mockFetch(200, { token: "new" });
    globalThis.fetch = fetchMock;
    await authApi.register("new@user.com", "secret");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "new@user.com", password: "secret" }),
      }),
    );
  });

  it("getSession fetches GET /api/auth/session", async () => {
    const fetchMock = mockFetch(200, { user_id: "u1" });
    globalThis.fetch = fetchMock;
    await authApi.getSession();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", expect.any(Object));
  });

  it("validate sends POST /api/auth/validate", async () => {
    const fetchMock = mockFetch(200, { user_id: "u1" });
    globalThis.fetch = fetchMock;
    await authApi.validate();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/validate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("logout sends POST /api/auth/logout", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;
    await authApi.logout();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("login throws ApiClientError on 401", async () => {
    globalThis.fetch = mockFetch(401, { error: "Invalid creds", code: "unauthorized", details: null });
    await expect(authApi.login("a@b.com", "wrong")).rejects.toThrow(ApiClientError);
  });
});
