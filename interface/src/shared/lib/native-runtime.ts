interface CapacitorWindow extends Window {
  Capacitor?: {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
  };
}

type RuntimeWindow = CapacitorWindow & {
  __AURA_BOOT_AUTH__?: unknown;
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  ipc?: {
    postMessage?: unknown;
  };
};

const LOOPBACK_WEBVIEW_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MOBILE_USER_AGENT_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

function hasWindow() {
  return typeof window !== "undefined";
}

export function isDesktopRuntime(): boolean {
  if (!hasWindow()) return false;

  const runtimeWindow = window as RuntimeWindow;
  return (
    typeof runtimeWindow.ipc?.postMessage === "function" ||
    typeof runtimeWindow.__AURA_BOOT_AUTH__ !== "undefined" ||
    typeof runtimeWindow.__TAURI__ !== "undefined" ||
    typeof runtimeWindow.__TAURI_INTERNALS__ !== "undefined"
  );
}

export function isNativeRuntime(): boolean {
  if (!hasWindow()) return false;
  if (isDesktopRuntime()) return false;

  const nativeCheck = (window as RuntimeWindow).Capacitor?.isNativePlatform;
  if (typeof nativeCheck === "function") {
    return Boolean(nativeCheck());
  }

  return window.location.protocol === "capacitor:" || (isLoopbackWebviewOrigin() && hasMobileUserAgent());
}

export function inferNativePlatform(): "android" | "ios" | null {
  if (!hasWindow() || !isNativeRuntime()) return null;

  const platformCheck = (window as RuntimeWindow).Capacitor?.getPlatform;
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

function hasMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return MOBILE_USER_AGENT_PATTERN.test(navigator.userAgent);
}
