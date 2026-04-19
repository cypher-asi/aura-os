import { useEffect, useState } from "react";
import { isNativeRuntime } from "../lib/native-runtime";

export const AURA_BREAKPOINTS = {
  phoneMax: 680,
  tabletMax: 900,
} as const;

const PHONE_MEDIA_QUERY = `(max-width: ${AURA_BREAKPOINTS.phoneMax}px)`;
const TABLET_MEDIA_QUERY = `(max-width: ${AURA_BREAKPOINTS.tabletMax}px)`;
const COARSE_POINTER_MEDIA_QUERY = "(pointer: coarse)";
const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";

export interface AuraFeatureAvailability {
  windowControls: boolean;
  linkedWorkspace: boolean;
  nativeUpdater: boolean;
  hostRetargeting: boolean;
  ideIntegration: boolean;
}

export interface AuraCapabilities {
  hasDesktopBridge: boolean;
  isMobileClient: boolean;
  isMobileLayout: boolean;
  isPhoneLayout: boolean;
  isTabletLayout: boolean;
  isStandalone: boolean;
  isNativeApp: boolean;
  features: AuraFeatureAvailability;
  supportsWindowControls: boolean;
  supportsDesktopWorkspace: boolean;
  supportsNativeUpdates: boolean;
  supportsHostRetargeting: boolean;
}

function buildFeatureAvailability(hasDesktopBridge: boolean, isMobileLayout: boolean): AuraFeatureAvailability {
  return {
    windowControls: hasDesktopBridge,
    linkedWorkspace: hasDesktopBridge && !isMobileLayout,
    nativeUpdater: hasDesktopBridge,
    hostRetargeting: !hasDesktopBridge,
    ideIntegration: hasDesktopBridge && !isMobileLayout,
  };
}

function readCapabilities(): AuraCapabilities {
  if (typeof window === "undefined") {
    const features = buildFeatureAvailability(false, false);
    return {
      hasDesktopBridge: false,
      isMobileClient: false,
      isMobileLayout: false,
      isPhoneLayout: false,
      isTabletLayout: false,
      isStandalone: false,
      isNativeApp: false,
      features,
      supportsWindowControls: features.windowControls,
      supportsDesktopWorkspace: features.linkedWorkspace,
      supportsNativeUpdates: features.nativeUpdater,
      supportsHostRetargeting: features.hostRetargeting,
    };
  }

  const hasDesktopBridge = typeof window.ipc?.postMessage === "function";
  const isPhoneLayout = window.matchMedia(PHONE_MEDIA_QUERY).matches;
  const isTabletLayout =
    window.matchMedia(TABLET_MEDIA_QUERY).matches ||
    window.matchMedia(COARSE_POINTER_MEDIA_QUERY).matches;
  const isMobileLayout = isTabletLayout;
  const isStandalone =
    window.matchMedia(STANDALONE_MEDIA_QUERY).matches ||
    (typeof navigator !== "undefined" && "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const isNativeApp = isNativeRuntime();
  const isMobileUserAgent =
    typeof navigator !== "undefined" &&
    (
      ("userAgentData" in navigator && Boolean((navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile)) ||
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    );
  const isMobileClient = isNativeApp || isMobileUserAgent;
  const features = buildFeatureAvailability(hasDesktopBridge, isMobileLayout);

  return {
    hasDesktopBridge,
    isMobileClient,
    isMobileLayout,
    isPhoneLayout,
    isTabletLayout,
    isStandalone,
    isNativeApp,
    features,
    supportsWindowControls: features.windowControls,
    supportsDesktopWorkspace: features.linkedWorkspace,
    supportsNativeUpdates: features.nativeUpdater,
    supportsHostRetargeting: features.hostRetargeting,
  };
}

export function useAuraCapabilities(): AuraCapabilities {
  const [capabilities, setCapabilities] = useState<AuraCapabilities>(() => readCapabilities());

  useEffect(() => {
    const phoneQuery = window.matchMedia(PHONE_MEDIA_QUERY);
    const tabletQuery = window.matchMedia(TABLET_MEDIA_QUERY);
    const pointerQuery = window.matchMedia(COARSE_POINTER_MEDIA_QUERY);
    const displayQuery = window.matchMedia(STANDALONE_MEDIA_QUERY);
    const update = () => setCapabilities(readCapabilities());

    update();
    phoneQuery.addEventListener("change", update);
    tabletQuery.addEventListener("change", update);
    pointerQuery.addEventListener("change", update);
    displayQuery.addEventListener("change", update);
    window.addEventListener("resize", update);

    return () => {
      phoneQuery.removeEventListener("change", update);
      tabletQuery.removeEventListener("change", update);
      pointerQuery.removeEventListener("change", update);
      displayQuery.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    root.dataset.mobileClient = capabilities.isMobileClient ? "true" : "false";
    root.dataset.mobileLayout = capabilities.isMobileLayout ? "true" : "false";

    return () => {
      delete root.dataset.mobileClient;
      delete root.dataset.mobileLayout;
    };
  }, [capabilities.isMobileClient, capabilities.isMobileLayout]);

  return capabilities;
}
