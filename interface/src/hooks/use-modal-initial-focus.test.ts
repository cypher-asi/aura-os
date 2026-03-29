import { renderHook } from "@testing-library/react";
import { useModalInitialFocus } from "./use-modal-initial-focus";

vi.mock("./use-aura-capabilities", () => ({
  useAuraCapabilities: vi.fn(() => ({
    isMobileLayout: false,
    isPhoneLayout: false,
    isTabletLayout: false,
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

import { useAuraCapabilities } from "./use-aura-capabilities";

const mockUseAuraCapabilities = vi.mocked(useAuraCapabilities);

describe("useModalInitialFocus", () => {
  it("returns initialFocusRef and autoFocus true on desktop", () => {
    const { result } = renderHook(() => useModalInitialFocus<HTMLInputElement>());

    expect(result.current.inputRef).toBeDefined();
    expect(result.current.initialFocusRef).toBeDefined();
    expect(result.current.autoFocus).toBe(true);
  });

  it("returns undefined initialFocusRef and autoFocus false on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({
      isMobileLayout: true,
      isPhoneLayout: true,
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
    });

    const { result } = renderHook(() => useModalInitialFocus<HTMLInputElement>());

    expect(result.current.initialFocusRef).toBeUndefined();
    expect(result.current.autoFocus).toBe(false);
  });
});
