import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectAppearanceStore } from "./project-appearance-store";
import { appearanceApi } from "../shared/api/appearance";

vi.mock("../shared/api/appearance", () => ({
  appearanceApi: {
    get: vi.fn(),
    update: vi.fn(),
    uploadBanner: vi.fn(),
    deleteBanner: vi.fn(),
  },
  projectBannerUrl: (id: string) => `/api/projects/${id}/appearance/banner`,
}));

const mockedApi = vi.mocked(appearanceApi);

describe("project-appearance-store", () => {
  beforeEach(() => {
    useProjectAppearanceStore.setState({
      entries: new Map(),
      inflight: new Map(),
    });
    mockedApi.get.mockReset();
    mockedApi.update.mockReset();
    mockedApi.uploadBanner.mockReset();
    mockedApi.deleteBanner.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("load fetches once and caches the result", async () => {
    mockedApi.get.mockResolvedValue({ accent: "#7c3aed" });
    const { load } = useProjectAppearanceStore.getState();

    const first = await load("p1");
    const second = await load("p1");

    expect(first).toEqual({ accent: "#7c3aed" });
    expect(second).toEqual({ accent: "#7c3aed" });
    // Cached on the second call — only one network round-trip.
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it("load dedupes concurrent calls for the same project", async () => {
    mockedApi.get.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ accent: "#222" }), 0)),
    );
    const { load } = useProjectAppearanceStore.getState();

    const [a, b] = await Promise.all([load("p2"), load("p2")]);

    expect(a).toEqual({ accent: "#222" });
    expect(b).toEqual({ accent: "#222" });
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it("update applies optimistically then takes the server's echo", async () => {
    mockedApi.update.mockResolvedValue({ accent: "#abc123" });
    const { update, getEntry } = useProjectAppearanceStore.getState();

    const next = { accent: "#abc123", icon: "rocket" };
    const promise = update("p3", next);

    // Optimistic write is visible synchronously after the call kicks off.
    expect(getEntry("p3").appearance).toEqual(next);

    await promise;

    // After the response lands, the server's shape becomes the source of truth.
    expect(useProjectAppearanceStore.getState().getEntry("p3").appearance).toEqual({
      accent: "#abc123",
    });
  });

  it("update rolls back the optimistic state when the server rejects", async () => {
    // Seed with a known prior appearance so the rollback target is non-empty.
    useProjectAppearanceStore.setState({
      entries: new Map([
        [
          "p4",
          {
            appearance: { accent: "#000" },
            loaded: true,
            loading: false,
            bannerVersion: 0,
          },
        ],
      ]),
    });
    mockedApi.update.mockRejectedValue(new Error("boom"));

    const { update } = useProjectAppearanceStore.getState();
    await expect(update("p4", { accent: "#fff" })).rejects.toThrow("boom");

    expect(useProjectAppearanceStore.getState().getEntry("p4").appearance).toEqual({
      accent: "#000",
    });
  });

  it("uploadBanner and deleteBanner bump the banner version so <img> URLs cache-bust", async () => {
    mockedApi.uploadBanner.mockResolvedValue({
      bannerUrl: "/api/projects/p5/appearance/banner",
    });
    mockedApi.deleteBanner.mockResolvedValue({ deleted: true });

    const fakeBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "image/png",
    });

    await useProjectAppearanceStore.getState().uploadBanner("p5", fakeBlob);
    expect(useProjectAppearanceStore.getState().getEntry("p5").bannerVersion).toBe(1);

    await useProjectAppearanceStore.getState().deleteBanner("p5");
    expect(useProjectAppearanceStore.getState().getEntry("p5").bannerVersion).toBe(2);
  });
});
