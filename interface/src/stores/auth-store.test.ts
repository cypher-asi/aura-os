import { describe, it, expect, beforeEach, vi } from "vitest";
import type { AuthSession, ZeroUser } from "../shared/types";

const { mockApi } = vi.hoisted(() => {
  const mockApi = {
    getSession: vi.fn(),
    validate: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    follows: {
      list: vi.fn().mockResolvedValue([]),
    },
  };
  return { mockApi };
});

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

vi.mock("../shared/api/auth", () => ({
  authApi: mockApi,
}));

vi.mock("../api/client", () => ({
  api: {
    follows: mockApi.follows,
  },
}));

vi.mock("../shared/api/core", () => ({
  ApiClientError: class ApiClientError extends Error {
    status: number;
    constructor(status: number, body: { error: string }) {
      super(body.error);
      this.status = status;
    }
  },
}));

const mockSession: AuthSession = {
  user_id: "u1",
  network_user_id: "nu1",
  profile_id: "p1",
  display_name: "Test User",
  profile_image: "https://img.test/avatar.png",
  primary_zid: "zid-1",
  zero_wallet: "0xabc",
  wallets: ["0xabc"],
  is_zero_pro: false,
  created_at: "2025-01-01T00:00:00Z",
  validated_at: "2025-01-01T00:00:00Z",
};

const sessionWithZeroProError: AuthSession = {
  ...mockSession,
  zero_pro_refresh_error: "Unable to verify ZERO Pro status right now.",
};

import { useAuthStore } from "./auth-store";
import { ApiClientError } from "../shared/api/core";
import { clearStoredAuth } from "../shared/lib/auth-token";

function expectedUser(session: AuthSession): ZeroUser {
  return {
    user_id: session.user_id,
    network_user_id: session.network_user_id,
    profile_id: session.profile_id,
    display_name: session.display_name,
    profile_image: session.profile_image,
    primary_zid: session.primary_zid,
    zero_wallet: session.zero_wallet,
    wallets: session.wallets,
    is_zero_pro: session.is_zero_pro,
  };
}

beforeEach(async () => {
  useAuthStore.setState({
    user: null,
    isLoading: true,
    hasResolvedInitialSession: false,
  });
  window.localStorage.removeItem("aura-jwt");
  window.localStorage.removeItem("aura-session");
  window.localStorage.removeItem("aura-force-logged-out");
  await clearStoredAuth();
  vi.clearAllMocks();
});

describe("auth-store", () => {
  describe("initial state", () => {
    it("has no user", () => {
      expect(useAuthStore.getState().user).toBeNull();
    });

    it("starts loading", () => {
      expect(useAuthStore.getState().isLoading).toBe(true);
    });

    it("starts with unresolved initial session", () => {
      expect(useAuthStore.getState().hasResolvedInitialSession).toBe(false);
    });
  });

  describe("restoreSession", () => {
    it("sets user from validated session", async () => {
      mockApi.getSession.mockResolvedValue(mockSession);

      await useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().user).toEqual(expectedUser(mockSession));
      expect(useAuthStore.getState().zeroProRefreshError).toBeNull();
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().hasResolvedInitialSession).toBe(true);
    });

    it("falls back to cached session when getSession fails", async () => {
      window.localStorage.setItem("aura-jwt", "stored-token");
      window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
      mockApi.getSession.mockRejectedValue(new Error("validation failed"));

      await useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().user).toEqual(
        expectedUser(mockSession),
      );
      expect(useAuthStore.getState().zeroProRefreshError).toBe("validation failed");
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().hasResolvedInitialSession).toBe(true);
    });

    it("clears the cached user when getSession returns 401", async () => {
      window.localStorage.setItem("aura-jwt", "expired-token");
      window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
      mockApi.getSession.mockRejectedValue(new ApiClientError(401, { error: "unauth" }));

      await useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().zeroProRefreshError).toBeNull();
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().hasResolvedInitialSession).toBe(true);
    });

    it("clears user on 401 from getSession", async () => {
      window.localStorage.setItem("aura-jwt", "expired-token");
      window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
      mockApi.getSession.mockRejectedValue(new ApiClientError(401, { error: "unauth" }));

      await useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().zeroProRefreshError).toBeNull();
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(window.localStorage.getItem("aura-jwt")).toBeNull();
    });

    it("does not clear user on non-401 errors when cached session exists", async () => {
      window.localStorage.setItem("aura-jwt", "stored-token");
      window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
      mockApi.getSession.mockRejectedValue(new Error("network error"));

      await useAuthStore.getState().restoreSession();

      expect(useAuthStore.getState().user).toEqual(expectedUser(mockSession));
      expect(useAuthStore.getState().zeroProRefreshError).toBe("network error");
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe("login", () => {
    it("sets user from session", async () => {
      mockApi.login.mockResolvedValue(mockSession);

      await useAuthStore.getState().login("a@b.com", "pass");

      expect(mockApi.login).toHaveBeenCalledWith("a@b.com", "pass");
      expect(useAuthStore.getState().user).toEqual(expectedUser(mockSession));
      expect(useAuthStore.getState().hasResolvedInitialSession).toBe(true);
    });

    it("propagates errors", async () => {
      mockApi.login.mockRejectedValue(new Error("bad creds"));
      await expect(useAuthStore.getState().login("a@b.com", "x")).rejects.toThrow("bad creds");
    });

    it("preserves a zero pro verification error from the session response", async () => {
      mockApi.login.mockResolvedValue(sessionWithZeroProError);

      await useAuthStore.getState().login("a@b.com", "pass");

      expect(useAuthStore.getState().user).toEqual(expectedUser(sessionWithZeroProError));
      expect(useAuthStore.getState().zeroProRefreshError).toBe(
        "Unable to verify ZERO Pro status right now.",
      );
    });
  });

  describe("refreshSession", () => {
    it("updates the user from validate", async () => {
      const validatedSession = {
        ...mockSession,
        is_zero_pro: true,
      };
      useAuthStore.setState({ user: expectedUser(mockSession), isLoading: false });
      mockApi.validate.mockResolvedValue(validatedSession);

      await useAuthStore.getState().refreshSession();

      expect(useAuthStore.getState().user).toEqual(expectedUser(validatedSession));
      expect(useAuthStore.getState().zeroProRefreshError).toBeNull();
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it("keeps a verification error from validate without logging the user out", async () => {
      useAuthStore.setState({ user: expectedUser(mockSession), isLoading: false });
      mockApi.validate.mockResolvedValue(sessionWithZeroProError);

      await useAuthStore.getState().refreshSession();

      expect(useAuthStore.getState().user).toEqual(expectedUser(sessionWithZeroProError));
      expect(useAuthStore.getState().zeroProRefreshError).toBe(
        "Unable to verify ZERO Pro status right now.",
      );
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it("clears the user on 401", async () => {
      useAuthStore.setState({ user: expectedUser(mockSession), isLoading: false });
      mockApi.validate.mockRejectedValue(new ApiClientError(401, { error: "unauth" }));

      await expect(useAuthStore.getState().refreshSession()).rejects.toThrow("unauth");
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().zeroProRefreshError).toBeNull();
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe("register", () => {
    it("sets user from session", async () => {
      mockApi.register.mockResolvedValue(mockSession);

      await useAuthStore.getState().register("a@b.com", "pass", "Test", "INVITE");

      expect(useAuthStore.getState().user).toEqual(expectedUser(mockSession));
    });

    it("preserves a zero pro verification error from registration", async () => {
      mockApi.register.mockResolvedValue(sessionWithZeroProError);

      await useAuthStore.getState().register("a@b.com", "pass", "Test", "INVITE");

      expect(useAuthStore.getState().user).toEqual(expectedUser(sessionWithZeroProError));
      expect(useAuthStore.getState().zeroProRefreshError).toBe(
        "Unable to verify ZERO Pro status right now.",
      );
    });
  });

  describe("logout", () => {
    it("clears the user", async () => {
      useAuthStore.setState({ user: expectedUser(mockSession) });
      mockApi.logout.mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().hasResolvedInitialSession).toBe(true);
    });

    it("clears local session state even when the server call fails", async () => {
      useAuthStore.setState({ user: expectedUser(mockSession) });
      window.localStorage.setItem("aura-jwt", "stale-token");
      window.localStorage.setItem("aura-session", JSON.stringify(mockSession));
      mockApi.logout.mockRejectedValue(new Error("network down"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await useAuthStore.getState().logout();

      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().hasResolvedInitialSession).toBe(true);
      expect(window.localStorage.getItem("aura-jwt")).toBeNull();
      expect(window.localStorage.getItem("aura-session")).toBeNull();
      warn.mockRestore();
    });

    it("arms the force-logged-out sentinel so stale boot literals cannot revive the session", async () => {
      useAuthStore.setState({ user: expectedUser(mockSession) });
      mockApi.logout.mockResolvedValue(undefined);

      await useAuthStore.getState().logout();

      expect(window.localStorage.getItem("aura-force-logged-out")).toBe("1");
    });
  });
});
