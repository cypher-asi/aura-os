import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockNavigate = vi.fn();
const logoutMock = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("./auth-store", () => ({
  useAuthStore: (selector: (s: { logout: typeof logoutMock }) => unknown) =>
    selector({ logout: logoutMock }),
}));

import { useLogout } from "./use-logout";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLogout", () => {
  it("clears the session then navigates to the public home", async () => {
    logoutMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useLogout());

    await result.current();

    expect(logoutMock).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("still navigates away when logout() rejects", async () => {
    logoutMock.mockRejectedValue(new Error("teardown failed"));
    const { result } = renderHook(() => useLogout());

    // The hook swallows the rejection via finally so callers using
    // `void logout()` never leave the user stranded on the authed surface.
    await expect(result.current()).rejects.toThrow("teardown failed");

    expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
  });
});
