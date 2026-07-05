import { renderHook, act, waitFor } from "@testing-library/react";
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
    setLocation("/login");
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

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.isNativeApp).toBe(true);
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
