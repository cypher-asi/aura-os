interface CapacitorWindow extends Window {
  Capacitor?: {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
  };
}

const LOOPBACK_WEBVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function hasWindow() {
  return typeof window !== "undefined";
}

export function isNativeRuntime(): boolean {
  if (!hasWindow()) return false;

  const nativeCheck = (window as CapacitorWindow).Capacitor?.isNativePlatform;
  if (typeof nativeCheck === "function") {
    return Boolean(nativeCheck());
  }

  return window.location.protocol === "capacitor:" || isLoopbackWebviewOrigin();
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

  const userAgent = window.navigator.userAgent.toLowerCase();
  if (userAgent.includes("android")) return "android";
  if (userAgent.includes("iphone") || userAgent.includes("ipad") || userAgent.includes("ipod")) return "ios";
  if (isLoopbackWebviewOrigin()) return null;
  return null;
}

function isLoopbackWebviewOrigin(): boolean {
  if (!hasWindow()) return false;
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return false;
  return LOOPBACK_WEBVIEW_HOSTS.has(window.location.hostname);
}
