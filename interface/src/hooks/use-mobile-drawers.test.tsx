import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useMobileDrawerEffects } from "./use-mobile-drawers";

const mockSetNavOpen = vi.fn();
const mockSetPreviewOpen = vi.fn();
const mockSetAccountOpen = vi.fn();
const mockCloseHostSettings = vi.fn();

vi.mock("./use-aura-capabilities", () => ({
  useAuraCapabilities: vi.fn(() => ({
    isMobileLayout: true,
    isPhoneLayout: false,
    isTabletLayout: true,
    hasDesktopBridge: false,
    isStandalone: false,
    features: {
      windowControls: false,
      linkedWorkspace: false,
      nativeUpdater: false,
      hostRetargeting: true,
      ideIntegration: false,
    },
    supportsWindowControls: false,
    supportsDesktopWorkspace: false,
    supportsNativeUpdates: false,
    supportsHostRetargeting: true,
  })),
}));

vi.mock("../stores/sidekick-store", () => ({
  useSidekick: vi.fn(() => ({
    previewItem: null,
  })),
}));

vi.mock("../stores/mobile-drawer-store", () => ({
  useMobileDrawerStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setNavOpen: mockSetNavOpen,
      setPreviewOpen: mockSetPreviewOpen,
      setAccountOpen: mockSetAccountOpen,
    }),
}));

vi.mock("../stores/ui-modal-store", () => ({
  useUIModalStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      closeHostSettings: mockCloseHostSettings,
    }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useMobileDrawerEffects", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    let rafId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes all drawers on mount in mobile layout", () => {
    renderHook(() => useMobileDrawerEffects(false), { wrapper });

    expect(mockSetNavOpen).toHaveBeenCalledWith(false);
    expect(mockSetPreviewOpen).toHaveBeenCalledWith(false);
    expect(mockSetAccountOpen).toHaveBeenCalledWith(false);
    expect(mockCloseHostSettings).toHaveBeenCalled();
  });

  it("closes preview when no preview panel", () => {
    renderHook(() => useMobileDrawerEffects(false), { wrapper });

    expect(mockSetPreviewOpen).toHaveBeenCalledWith(false);
  });
});
