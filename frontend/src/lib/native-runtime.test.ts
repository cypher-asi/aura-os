import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inferNativePlatform, isNativeRuntime } from "./native-runtime";

const originalLocation = window.location;

function setLocation(url: string) {
  const parsed = new URL(url, "http://app.local");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...originalLocation,
      href: parsed.toString(),
      origin: parsed.origin,
      protocol: parsed.protocol,
      host: parsed.host,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    } satisfies Partial<Location>,
  });
}

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

describe("native-runtime", () => {
  beforeEach(() => {
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    setLocation("/login");
  });

  afterEach(() => {
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    setLocation("/login");
  });

  it("treats Android localhost webviews as native even before the bridge is ready", () => {
    setLocation("http://localhost/login");

    expect(isNativeRuntime()).toBe(true);
    expect(inferNativePlatform()).toBe("android");
  });

  it("treats the iOS capacitor protocol as native", () => {
    setLocation("capacitor://localhost/login");

    expect(isNativeRuntime()).toBe(true);
    expect(inferNativePlatform()).toBe("ios");
  });

  it("uses the Capacitor bridge when it is available", () => {
    (window as Window & {
      Capacitor?: { getPlatform: () => string; isNativePlatform: () => boolean };
    }).Capacitor = {
      getPlatform: () => "android",
      isNativePlatform: () => true,
    };

    expect(isNativeRuntime()).toBe(true);
    expect(inferNativePlatform()).toBe("android");
  });

  it("stays false for normal browser origins", () => {
    setLocation("https://zero.tech/login");

    expect(isNativeRuntime()).toBe(false);
    expect(inferNativePlatform()).toBeNull();
  });
});
