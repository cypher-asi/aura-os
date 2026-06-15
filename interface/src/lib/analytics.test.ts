/**
 * Analytics pipeline test.
 *
 * Proves the `track()` wrapper actually forwards to the Mixpanel SDK (and stays
 * a safe no-op without a token). This guards the "token present but pipeline
 * dead" failure mode that the build guard and contract test don't cover: a
 * refactor that silently disconnects the wrapper from the SDK would leave every
 * call site intact (contract test passes) and the token baked in (build guard
 * passes) yet send nothing. Here we assert the SDK is actually called.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mp = vi.hoisted(() => ({
  init: vi.fn(),
  track: vi.fn(),
  register: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  opt_out_tracking: vi.fn(),
  opt_in_tracking: vi.fn(),
}));

vi.mock("mixpanel-browser", () => ({ default: mp }));
vi.mock("./build-info", () => ({
  getAppPlatform: () => "web",
  getAppVersion: () => "test-version",
}));

/** Load a fresh copy of the analytics module with a chosen build-time token. */
async function loadAnalytics(token: string) {
  vi.resetModules();
  Object.values(mp).forEach((fn) => fn.mockReset());
  vi.stubEnv("VITE_MIXPANEL_TOKEN", token);
  return import("./analytics");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("analytics pipeline", () => {
  it("initAnalytics() forwards to mixpanel.init when a token is present", async () => {
    const a = await loadAnalytics("test-token-123");
    a.initAnalytics();
    expect(mp.init).toHaveBeenCalledTimes(1);
    expect(mp.init).toHaveBeenCalledWith("test-token-123", expect.any(Object));
  });

  it("track() forwards the event to mixpanel.track after init", async () => {
    const a = await loadAnalytics("test-token-123");
    a.initAnalytics();
    a.track("app_opened");
    expect(mp.track).toHaveBeenCalledWith("app_opened", undefined);
  });

  it("track() forwards event properties through to the SDK", async () => {
    const a = await loadAnalytics("test-token-123");
    a.initAnalytics();
    a.track("chat_message_sent", { model: "opus", mode: "code" });
    expect(mp.track).toHaveBeenCalledWith("chat_message_sent", { model: "opus", mode: "code" });
  });

  it("identifyUser() forwards identity + is_authenticated to the SDK", async () => {
    const a = await loadAnalytics("test-token-123");
    a.initAnalytics();
    a.identifyUser("user-123");
    expect(mp.identify).toHaveBeenCalledWith("user-123");
    expect(mp.register).toHaveBeenCalledWith({ is_authenticated: true });
  });

  it("is a safe no-op when the token is absent (the build guard is the real protection)", async () => {
    const a = await loadAnalytics("");
    a.initAnalytics();
    a.track("app_opened");
    expect(mp.init).not.toHaveBeenCalled();
    expect(mp.track).not.toHaveBeenCalled();
  });
});
