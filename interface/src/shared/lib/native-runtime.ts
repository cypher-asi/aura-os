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

// The desktop shell is served from a loopback origin (http://127.0.0.1:<port>),
// which isLoopbackWebviewOrigin() would otherwise classify as native. It is not
// a native mobile runtime: it injects a desktop bridge global on the window.
// When that bridge is present we must treat the app as a desktop client, so
// capability and host detection do not flip it into the mobile UI.
function isDesktopShell(): boolean {
  if (!hasWindow()) return false;
  const w = window as unknown as Record<string, unknown>;
  return (
    typeof w.__AURA_BOOT_AUTH__ !== "undefined" ||
    typeof w.__TAURI__ !== "undefined" ||
    typeof w.__TAURI_INTERNALS__ !== "undefined"
  );
}

export function isNativeRuntime(): boolean {
  if (!hasWindow()) return false;
  if (isDesktopShell()) return false;

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
