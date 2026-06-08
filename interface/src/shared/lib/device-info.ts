import { inferNativePlatform, isNativeRuntime } from "./native-runtime";

export type ClientPlatform = "desktop" | "mobile" | "web";

/**
 * Detect which client surface the app is currently running on. Mirrors
 * the heuristics used by the bug-diagnostics collector: the desktop
 * shell injects `__AURA_BOOT_AUTH__` / Tauri globals, the mobile shell
 * runs inside a Capacitor native runtime, and everything else is the
 * plain web build.
 */
export function detectClientPlatform(): ClientPlatform {
  try {
    const w = window as unknown as Record<string, unknown>;
    const isDesktop =
      typeof w.__AURA_BOOT_AUTH__ !== "undefined" ||
      typeof w.__TAURI__ !== "undefined" ||
      typeof w.__TAURI_INTERNALS__ !== "undefined";
    if (isDesktop) return "desktop";
    if (isNativeRuntime() || inferNativePlatform() !== null) return "mobile";
    return "web";
  } catch {
    return "web";
  }
}

const PLATFORM_LABEL: Record<ClientPlatform, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  web: "Web",
};

export interface ClientDeviceParts {
  /** Real machine hostname when known (desktop env info). */
  hostname?: string | null;
  /** Real OS string when known (desktop env info). */
  os?: string | null;
  /** Machine IP address when known (desktop env info). */
  ip?: string | null;
}

/**
 * Human-readable label for the device the user is currently running the
 * app on, e.g. `"Desktop - Windows (DESKTOP-ABC)"` or `"Web - MacIntel"`.
 * Prefers explicit env info (hostname / os) and falls back to native
 * platform hints and `navigator.platform` so the label is never empty.
 */
export function formatClientDevice(parts: ClientDeviceParts = {}): string {
  const platform = detectClientPlatform();
  const label = PLATFORM_LABEL[platform];

  let nativePlatform: "android" | "ios" | null = null;
  try {
    nativePlatform = inferNativePlatform();
  } catch {
    nativePlatform = null;
  }

  let os = parts.os?.trim() || null;
  if (!os) {
    if (nativePlatform === "ios") os = "iOS";
    else if (nativePlatform === "android") os = "Android";
    else {
      try {
        os = typeof navigator !== "undefined" ? navigator.platform || null : null;
      } catch {
        os = null;
      }
    }
  }

  const host = parts.hostname?.trim() || null;
  const ip = parts.ip?.trim() || null;
  const base = os ? `${label} - ${os}` : label;
  const inner = [host, ip].filter(Boolean).join(", ");
  return inner ? `${base} (${inner})` : base;
}
