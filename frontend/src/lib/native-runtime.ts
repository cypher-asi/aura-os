interface CapacitorWindow extends Window {
  Capacitor?: {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
  };
}

const LOCALHOST_WEBVIEW_ORIGINS = new Set(["http://localhost", "https://localhost"]);

function hasWindow() {
  return typeof window !== "undefined";
}

export function isNativeRuntime(): boolean {
  if (!hasWindow()) return false;

  const nativeCheck = (window as CapacitorWindow).Capacitor?.isNativePlatform;
  if (typeof nativeCheck === "function") {
    return Boolean(nativeCheck());
  }

  return window.location.protocol === "capacitor:" || LOCALHOST_WEBVIEW_ORIGINS.has(window.location.origin);
}

export function inferNativePlatform(): "android" | "ios" | null {
  if (!hasWindow() || !isNativeRuntime()) return null;

  const platformCheck = (window as CapacitorWindow).Capacitor?.getPlatform;
  if (typeof platformCheck === "function") {
    try {
      const platform = platformCheck();
      if (platform === "android" || platform === "ios") return platform;
    } catch {
      // Fall through to origin and user-agent heuristics.
    }
  }

  if (window.location.protocol === "capacitor:") return "ios";
  if (LOCALHOST_WEBVIEW_ORIGINS.has(window.location.origin)) return "android";

  const userAgent = window.navigator.userAgent.toLowerCase();
  if (userAgent.includes("android")) return "android";
  if (userAgent.includes("iphone") || userAgent.includes("ipad") || userAgent.includes("ipod")) return "ios";
  return null;
}
