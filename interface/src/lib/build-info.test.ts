import { describe, expect, it } from "vitest";
import { formatBuildTime, getAppVersion, getBuildInfo } from "./build-info";

describe("getBuildInfo", () => {
  it("returns the values baked in at build time", () => {
    const info = getBuildInfo();
    expect(info.version).toBe("0.0.0-test");
    expect(info.commit).toBe("testcommit");
    expect(info.buildTime).toBe("2026-04-17T00:00:00.000Z");
    expect(info.channel).toBe("test");
  });

  it("flags non-dev builds", () => {
    expect(getBuildInfo().isDev).toBe(false);
  });
});

describe("getAppVersion", () => {
  it("collapses the continuously-deployed web surface to the 0.0.0 label", () => {
    // jsdom has no Electron `ipc` / Capacitor globals -> platform is web.
    expect(getAppVersion()).toBe("0.0.0");
  });

  it("reports the real baked release version on desktop", () => {
    const w = window as unknown as { ipc?: object };
    w.ipc = {};
    try {
      expect(getAppVersion()).toBe("0.0.0-test");
    } finally {
      delete w.ipc;
    }
  });
});

describe("formatBuildTime", () => {
  it("formats an ISO timestamp into a locale string", () => {
    const formatted = formatBuildTime("2026-04-17T12:34:00.000Z", "en-US");
    expect(formatted).not.toBe("2026-04-17T12:34:00.000Z");
    expect(formatted).toMatch(/2026/);
  });

  it("returns a friendly label for dev builds", () => {
    expect(formatBuildTime("dev")).toBe("Development build");
    expect(formatBuildTime("")).toBe("Development build");
  });

  it("returns the raw value when unparseable", () => {
    expect(formatBuildTime("not-a-date")).toBe("not-a-date");
  });
});
