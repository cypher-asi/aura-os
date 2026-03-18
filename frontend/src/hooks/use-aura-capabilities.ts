import { useEffect, useState } from "react";

export interface AuraCapabilities {
  hasDesktopBridge: boolean;
  isMobileLayout: boolean;
  isStandalone: boolean;
  supportsWindowControls: boolean;
  supportsDesktopWorkspace: boolean;
  supportsNativeUpdates: boolean;
  supportsHostRetargeting: boolean;
}

function readCapabilities(): AuraCapabilities {
  if (typeof window === "undefined") {
    return {
      hasDesktopBridge: false,
      isMobileLayout: false,
      isStandalone: false,
      supportsWindowControls: false,
      supportsDesktopWorkspace: false,
      supportsNativeUpdates: false,
      supportsHostRetargeting: false,
    };
  }

  const hasDesktopBridge = typeof window.ipc?.postMessage === "function";
  const isMobileLayout =
    window.matchMedia("(max-width: 900px)").matches ||
    window.matchMedia("(pointer: coarse)").matches;
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (typeof navigator !== "undefined" && "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

  return {
    hasDesktopBridge,
    isMobileLayout,
    isStandalone,
    supportsWindowControls: hasDesktopBridge,
    supportsDesktopWorkspace: hasDesktopBridge && !isMobileLayout,
    supportsNativeUpdates: hasDesktopBridge,
    supportsHostRetargeting: !hasDesktopBridge,
  };
}

export function useAuraCapabilities(): AuraCapabilities {
  const [capabilities, setCapabilities] = useState<AuraCapabilities>(() => readCapabilities());

  useEffect(() => {
    const widthQuery = window.matchMedia("(max-width: 900px)");
    const pointerQuery = window.matchMedia("(pointer: coarse)");
    const displayQuery = window.matchMedia("(display-mode: standalone)");
    const update = () => setCapabilities(readCapabilities());

    update();
    widthQuery.addEventListener("change", update);
    pointerQuery.addEventListener("change", update);
    displayQuery.addEventListener("change", update);
    window.addEventListener("resize", update);

    return () => {
      widthQuery.removeEventListener("change", update);
      pointerQuery.removeEventListener("change", update);
      displayQuery.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return capabilities;
}
