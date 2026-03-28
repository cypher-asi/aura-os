import { describe, it, expect, beforeEach, vi } from "vitest";

const { hoisted, fetchMock } = vi.hoisted(() => {
  const hoisted = { mockHostOrigin: null as string | null, mockRequiresExplicitHost: false };
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
  });
  return { hoisted, fetchMock };
});

vi.mock("../lib/host-config", () => ({
  getConfiguredHostOrigin: () => hoisted.mockHostOrigin,
  requiresExplicitHostOrigin: () => hoisted.mockRequiresExplicitHost,
  setConfiguredHostOrigin: (v: string | null) => {
    hoisted.mockHostOrigin = v;
    return v;
  },
  resolveApiUrl: (path: string) => `http://localhost${path}`,
  subscribeToHostChanges: vi.fn(),
}));

vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("setInterval", vi.fn());
vi.stubGlobal("addEventListener", vi.fn());

import { useHostStore } from "./host-store";

function flushProbes(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  await flushProbes();
  hoisted.mockHostOrigin = null;
  hoisted.mockRequiresExplicitHost = false;
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
  });
  useHostStore.setState({ hostOrigin: null, status: "checking", lastCheckedAt: null });
});

describe("host-store", () => {
  describe("initial state shape", () => {
    it("has a status field", () => {
      expect(useHostStore.getState().status).toBe("checking");
    });

    it("has a lastCheckedAt field", () => {
      expect(useHostStore.getState().lastCheckedAt).toBeNull();
    });
  });

  describe("setHostOrigin", () => {
    it("updates hostOrigin in store", () => {
      useHostStore.getState().setHostOrigin("http://example.com");
      expect(useHostStore.getState().hostOrigin).toBe("http://example.com");
    });

    it("returns the new value", () => {
      const result = useHostStore.getState().setHostOrigin("http://test.com");
      expect(result).toBe("http://test.com");
    });
  });

  describe("refreshStatus", () => {
    it("sets status to online on 200", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, headers: { get: () => "application/json" } });

      await useHostStore.getState().refreshStatus();

      expect(useHostStore.getState().status).toBe("online");
      expect(useHostStore.getState().lastCheckedAt).toBeTypeOf("number");
    });

    it("sets auth_required on 401", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, headers: { get: () => "application/json" } });

      await useHostStore.getState().refreshStatus();

      expect(useHostStore.getState().status).toBe("auth_required");
    });

    it("sets unreachable on 502", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 502, headers: { get: () => "application/json" } });

      await useHostStore.getState().refreshStatus();

      expect(useHostStore.getState().status).toBe("unreachable");
    });

    it("sets unreachable on fetch error", async () => {
      fetchMock.mockRejectedValue(new Error("network"));

      await useHostStore.getState().refreshStatus();

      expect(useHostStore.getState().status).toBe("unreachable");
    });

    it("sets error on 500", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, headers: { get: () => "application/json" } });

      await useHostStore.getState().refreshStatus();

      expect(useHostStore.getState().status).toBe("error");
    });

    it("sets unreachable when native requires a host and none is configured", async () => {
      hoisted.mockRequiresExplicitHost = true;

      await useHostStore.getState().refreshStatus();

      expect(useHostStore.getState().status).toBe("unreachable");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sets unreachable when the probe returns html instead of json", async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, headers: { get: () => "text/html" } });

      await useHostStore.getState().refreshStatus();

      expect(useHostStore.getState().status).toBe("unreachable");
    });
  });
});
