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
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mp = vi.hoisted(() => ({
  init: vi.fn(),
  track: vi.fn(),
  register: vi.fn(),
  register_once: vi.fn(),
  get_property: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  opt_out_tracking: vi.fn(),
  opt_in_tracking: vi.fn(),
  people: { set_once: vi.fn() },
}));

vi.mock("mixpanel-browser", () => ({ default: mp }));
vi.mock("./build-info", () => ({
  getAppPlatform: () => "web",
  getAppVersion: () => "test-version",
}));

/** Load a fresh copy of the analytics module with a chosen build-time token. */
async function loadAnalytics(token: string) {
  vi.resetModules();
  Object.values(mp).forEach((fn) => {
    if (typeof (fn as { mockReset?: () => void }).mockReset === "function") {
      (fn as { mockReset: () => void }).mockReset();
    }
  });
  mp.people.set_once.mockReset();
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

  it("initAnalytics() stamps a first-touch acquisition_source via register_once", async () => {
    const a = await loadAnalytics("test-token-123");
    a.initAnalytics();
    // jsdom defaults: empty referrer + no query string -> "direct".
    expect(mp.register_once).toHaveBeenCalledWith({ acquisition_source: "direct" });
  });

  it("identifyUser() mirrors the first-touch source onto the profile (set_once)", async () => {
    const a = await loadAnalytics("test-token-123");
    a.initAnalytics();
    mp.get_property.mockReturnValue("x");
    a.identifyUser("user-123");
    expect(mp.people.set_once).toHaveBeenCalledWith({ acquisition_source: "x" });
  });

  it("identifyUser() does not set a profile source when none was captured", async () => {
    const a = await loadAnalytics("test-token-123");
    a.initAnalytics();
    mp.get_property.mockReturnValue(undefined);
    a.identifyUser("user-123");
    expect(mp.people.set_once).not.toHaveBeenCalled();
  });
});

describe("classifyAcquisitionSource", () => {
  let classify: (referrer: string, search: string) => string;
  beforeAll(async () => {
    classify = (await loadAnalytics("test-token-123")).classifyAcquisitionSource;
  });

  it("an explicit utm_source always wins over the referrer", () => {
    expect(classify("https://www.google.com/", "?utm_source=Newsletter")).toBe("newsletter");
  });

  it("collapses X / Twitter domains to 'x'", () => {
    expect(classify("https://t.co/abc", "")).toBe("x");
    expect(classify("https://twitter.com/foo", "")).toBe("x");
    expect(classify("https://x.com/foo", "")).toBe("x");
  });

  it("maps every known source to its tidy label", () => {
    expect(classify("https://www.google.co.uk/search", "")).toBe("google");
    expect(classify("https://youtu.be/abc", "")).toBe("youtube");
    expect(classify("https://www.youtube.com/watch", "")).toBe("youtube");
    expect(classify("https://www.reddit.com/r/x", "")).toBe("reddit");
    expect(classify("https://github.com/cypher-asi", "")).toBe("github");
    expect(classify("https://lnkd.in/abc", "")).toBe("linkedin");
    expect(classify("https://www.linkedin.com/feed", "")).toBe("linkedin");
    expect(classify("https://www.facebook.com/x", "")).toBe("facebook");
    expect(classify("https://news.ycombinator.com/item", "")).toBe("hackernews");
  });

  it("keeps the real domain for any unlisted referrer", () => {
    expect(classify("https://www.producthunt.com/posts/aura", "")).toBe("producthunt.com");
  });

  it("returns 'direct' for an empty or malformed referrer", () => {
    expect(classify("", "")).toBe("direct");
    expect(classify("not a url", "")).toBe("direct");
  });
});
