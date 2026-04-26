declare global {
  interface Window {
    __AURA_ENABLE_SCREENSHOT_BRIDGE__?: boolean;
    __AURA_CAPTURE_SESSION_ACTIVE__?: boolean;
    __AURA_CAPTURE_BRIDGE__?: {
      version: number;
      getState: () => unknown;
      resetShell: (options?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

export function shouldEnableAuraScreenshotBridge(): boolean {
  const envEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_SCREENSHOT_BRIDGE === "1";

  if (typeof window === "undefined") {
    return envEnabled;
  }

  return envEnabled || window.__AURA_ENABLE_SCREENSHOT_BRIDGE__ === true;
}

export function markAuraCaptureSessionActive(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.__AURA_CAPTURE_SESSION_ACTIVE__ = true;
}

export function isAuraCaptureSessionActive(): boolean {
  return typeof window !== "undefined" && window.__AURA_CAPTURE_SESSION_ACTIVE__ === true;
}
