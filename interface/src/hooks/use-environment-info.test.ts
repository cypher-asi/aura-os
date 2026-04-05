import { renderHook, waitFor } from "@testing-library/react";

const mockGetEnvironmentInfo = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    environment: {
      getEnvironmentInfo: (...args: unknown[]) => mockGetEnvironmentInfo(...args),
    },
  },
}));

describe("useEnvironmentInfo", () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetEnvironmentInfo.mockReset();
  });

  it("returns data after successful fetch", async () => {
    const envInfo = { version: "1.0.0", platform: "linux" };
    mockGetEnvironmentInfo.mockResolvedValue(envInfo);

    const { useEnvironmentInfo } = await import("./use-environment-info");
    const { result } = renderHook(() => useEnvironmentInfo());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(envInfo);
    expect(mockGetEnvironmentInfo).toHaveBeenCalledOnce();
  });

  it("stops loading on fetch failure", async () => {
    mockGetEnvironmentInfo.mockRejectedValue(new Error("network error"));

    const { useEnvironmentInfo } = await import("./use-environment-info");
    const { result } = renderHook(() => useEnvironmentInfo());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
  });

  it("caches result across multiple hook instances", async () => {
    const envInfo = { version: "2.0.0", platform: "darwin" };
    mockGetEnvironmentInfo.mockResolvedValue(envInfo);

    const mod = await import("./use-environment-info");
    const { result: result1 } = renderHook(() => mod.useEnvironmentInfo());

    await waitFor(() => {
      expect(result1.current.data).toEqual(envInfo);
    });

    const { result: result2 } = renderHook(() => mod.useEnvironmentInfo());
    expect(result2.current.data).toEqual(envInfo);
    expect(result2.current.loading).toBe(false);
    expect(mockGetEnvironmentInfo).toHaveBeenCalledOnce();
  });
});
