import { renderHook, act } from "@testing-library/react";
import { useAuraCapabilities, AURA_BREAKPOINTS } from "./use-aura-capabilities";

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
  });

  afterEach(() => {
    window.matchMedia = origMatchMedia;
    setLocation("/login");
  });

  it("returns default desktop capabilities", () => {
    const { matchMedia } = createMockMatchMedia();
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;

    const { result } = renderHook(() => useAuraCapabilities());

    expect(result.current.isMobileLayout).toBe(false);
    expect(result.current.isPhoneLayout).toBe(false);
    expect(result.current.isTabletLayout).toBe(false);
    expect(result.current.hasDesktopBridge).toBe(false);
    expect(result.current.isNativeApp).toBe(false);
    expect(result.current.features.hostRetargeting).toBe(true);
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
