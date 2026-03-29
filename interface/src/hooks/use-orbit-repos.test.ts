import { renderHook, act } from "@testing-library/react";
import { useOrbitRepos } from "./use-orbit-repos";

vi.mock("../api/client", () => ({
  api: {
    listOrbitRepos: vi.fn(),
  },
}));

import { api } from "../api/client";

const mockListOrbitRepos = vi.mocked(api.listOrbitRepos);

describe("useOrbitRepos", () => {
  beforeEach(() => {
    mockListOrbitRepos.mockReset();
  });

  it("returns empty repos initially", () => {
    const { result } = renderHook(() => useOrbitRepos(false, "default", true));

    expect(result.current.orbitRepos).toEqual([]);
    expect(result.current.orbitReposLoading).toBe(false);
  });

  it("fetches repos when open + existing mode + authenticated", async () => {
    const repos = [{ name: "repo-1", owner: "user1" }];
    mockListOrbitRepos.mockResolvedValue(repos);

    const { result } = renderHook(() => useOrbitRepos(true, "existing", true));

    await vi.waitFor(() => {
      expect(result.current.orbitRepos).toEqual(repos);
    });
    expect(result.current.orbitReposLoading).toBe(false);
  });

  it("does not fetch when not open", () => {
    renderHook(() => useOrbitRepos(false, "existing", true));
    expect(mockListOrbitRepos).not.toHaveBeenCalled();
  });

  it("does not fetch when mode is not existing", () => {
    renderHook(() => useOrbitRepos(true, "default", true));
    expect(mockListOrbitRepos).not.toHaveBeenCalled();
  });

  it("does not fetch when not authenticated", () => {
    renderHook(() => useOrbitRepos(true, "existing", false));
    expect(mockListOrbitRepos).not.toHaveBeenCalled();
  });

  it("handles API failure gracefully", async () => {
    mockListOrbitRepos.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useOrbitRepos(true, "existing", true));

    await vi.waitFor(() => {
      expect(result.current.orbitReposLoading).toBe(false);
    });

    expect(result.current.orbitRepos).toEqual([]);
  });

  it("resetOrbitRepos clears the list", async () => {
    mockListOrbitRepos.mockResolvedValue([{ name: "r", owner: "o" }]);

    const { result } = renderHook(() => useOrbitRepos(true, "existing", true));

    await vi.waitFor(() => {
      expect(result.current.orbitRepos.length).toBe(1);
    });

    act(() => {
      result.current.resetOrbitRepos();
    });

    expect(result.current.orbitRepos).toEqual([]);
  });
});
