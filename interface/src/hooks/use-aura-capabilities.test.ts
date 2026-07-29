import { renderHook, waitFor } from "@testing-library/react";
import {
  useAuraCapabilities,
  AURA_BREAKPOINTS,
  resetAuraCapabilitiesForTests,
} from "./use-aura-capabilities";

type MediaQueryHandler = (e: { matches: boolean }) => void;

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

function createMockMatchMedia() {
  const listeners = new Map<string, Set<MediaQueryHandler>>();

  const matchMedia = vi.fn((query: string) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    return {
      matches: false,
      media: query,
      addEventListener: (_: string, handler: MediaQueryHandler) => {
        listeners.get(query)!.add(handler);
      },
      removeEventListener: (_: string, handler: MediaQueryHandler) => {
        listeners.get(query)!.delete(handler);
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    };
  });

  return { matchMedia, listeners };
}

describe("useAuraCapabilities", () => {
  let origMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    origMatchMedia = window.matchMedia;
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    setLocation("/login");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("runtime capabilities unavailable"))),
    );
    resetAuraCapabilitiesForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.matchMedia = origMatchMedia;
    setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    setLocation("/login");
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
    delete (window as Window & { __AURA_BOOT_AUTH__?: unknown }).__AURA_BOOT_AUTH__;
    delete (window as Window & { ipc?: unknown }).ipc;
    delete document.documentElement.dataset.mobileClient;
    delete document.documentElement.dataset.mobileLayout;
    resetAuraCapabilitiesForTests();
  });

  it("returns default desktop capabilities", () => {
    const { matchMedia } = createMockMatchMedia();
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.isMobileLayout).toBe(false);
    expect(result.current.isPhoneLayout).toBe(false);
    expect(result.current.isTabletLayout).toBe(false);
    expect(result.current.hasDesktopBridge).toBe(false);
    expect(result.current.remoteOnly).toBe(true);
    expect(result.current.localAgentRuntimeAvailable).toBe(false);
    expect(result.current.isNativeApp).toBe(false);
    expect(result.current.features.hostRetargeting).toBe(true);
    expect(document.documentElement.dataset.mobileClient).toBe("false");
    expect(document.documentElement.dataset.mobileLayout).toBe("false");
  });

  it("keeps desktop bridge clients out of remote-only mode", () => {
    const { matchMedia } = createMockMatchMedia();
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    (window as Window & { ipc?: { postMessage: () => void } }).ipc = {
      postMessage: vi.fn(),
    };

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.hasDesktopBridge).toBe(true);
    expect(result.current.remoteOnly).toBe(false);
    expect(result.current.localAgentRuntimeAvailable).toBe(true);

    delete (window as Window & { ipc?: { postMessage: () => void } }).ipc;
  });

  it("keeps desktop workspace features when the desktop window is narrow", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === `(max-width: ${AURA_BREAKPOINTS.phoneMax}px)` ||
               query === `(max-width: ${AURA_BREAKPOINTS.tabletMax}px)`,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    (window as Window & { ipc?: { postMessage: () => void } }).ipc = {
      postMessage: vi.fn(),
    };

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.isMobileLayout).toBe(true);
    expect(result.current.hasDesktopBridge).toBe(true);
    expect(result.current.features.linkedWorkspace).toBe(true);
    expect(result.current.features.ideIntegration).toBe(true);
    expect(result.current.supportsDesktopWorkspace).toBe(true);

    delete (window as Window & { ipc?: { postMessage: () => void } }).ipc;
  });

  it("unlocks local-agent runtime on web when the server reports hosted harness support", async () => {
    const { matchMedia } = createMockMatchMedia();
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              remoteOnly: false,
              localAgentRuntimeAvailable: true,
              hostedLocalHarness: true,
              hostedSafeWorkspace: true,
            }),
        }),
      ),
    );

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.hasDesktopBridge).toBe(false);
    expect(result.current.remoteOnly).toBe(true);
    await waitFor(() => {
      expect(result.current.remoteOnly).toBe(false);
      expect(result.current.localAgentRuntimeAvailable).toBe(true);
      expect(result.current.hostedLocalHarness).toBe(true);
      expect(result.current.hostedSafeWorkspace).toBe(true);
    });
  });

  it("honors server remote-only mode even inside the desktop shell", async () => {
    const { matchMedia } = createMockMatchMedia();
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    (window as Window & { ipc?: { postMessage: () => void } }).ipc = {
      postMessage: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              remoteOnly: true,
              localAgentRuntimeAvailable: false,
              hostedLocalHarness: false,
            }),
        }),
      ),
    );

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.hasDesktopBridge).toBe(true);
    expect(result.current.remoteOnly).toBe(false);
    await waitFor(() => {
      expect(result.current.remoteOnly).toBe(true);
      expect(result.current.localAgentRuntimeAvailable).toBe(false);
      expect(result.current.serverRemoteOnly).toBe(true);
    });

    delete (window as Window & { ipc?: { postMessage: () => void } }).ipc;
  });

  it("detects phone layout", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === `(max-width: ${AURA_BREAKPOINTS.phoneMax}px)` ||
               query === `(max-width: ${AURA_BREAKPOINTS.tabletMax}px)`,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.isPhoneLayout).toBe(true);
    expect(result.current.isTabletLayout).toBe(true);
    expect(result.current.isMobileLayout).toBe(true);
  });

  it("detects a Capacitor native shell", () => {
    const { matchMedia } = createMockMatchMedia();
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    (window as Window & { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor = {
      isNativePlatform: () => true,
    };

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.isNativeApp).toBe(true);
    expect(document.documentElement.dataset.mobileClient).toBe("true");

    delete (window as Window & { Capacitor?: { isNativePlatform: () => boolean } }).Capacitor;
  });

  it("treats Android localhost webviews as native before the bridge is ready", () => {
    const { matchMedia } = createMockMatchMedia();
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    setLocation("http://localhost/login");
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 3a)");

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.isNativeApp).toBe(true);
  });

  it("keeps desktop loopback clients out of native mobile mode", () => {
    const { matchMedia } = createMockMatchMedia();
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    setLocation("http://127.0.0.1:19847/projects");
    (window as Window & { ipc?: { postMessage: () => void } }).ipc = {
      postMessage: vi.fn(),
    };

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.hasDesktopBridge).toBe(true);
    expect(result.current.isNativeApp).toBe(false);
    expect(result.current.isMobileClient).toBe(false);
    expect(document.documentElement.dataset.mobileClient).toBe("false");
  });

  it("cleans up listeners on unmount", () => {
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    const removeWindowListener = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useAuraCapabilities());
    unmount();

    expect(removeEventListener).toHaveBeenCalled();
    expect(removeWindowListener).toHaveBeenCalledWith("resize", expect.any(Function));
    removeWindowListener.mockRestore();
  });
});
