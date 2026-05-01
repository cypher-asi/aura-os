/**
 * Product analytics wrapper (Mixpanel).
 *
 * Anonymous by default — user ID is a UUID, no emails/names/prompts.
 * Opt-out via localStorage toggle. Respects DNT/GPC browser signals.
 * Safe no-op when token is unset (dev/preview) or user opts out.
 */

import mixpanel from "mixpanel-browser";

const MIXPANEL_TOKEN = import.meta.env.VITE_MIXPANEL_TOKEN?.trim() ?? "";
const OPT_OUT_KEY = "aura-analytics-opt-out";

let initialized = false;

/** Check if the browser signals Do Not Track or Global Privacy Control. */
function browserSignalsDNT(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

/** Check if user has opted out via settings toggle. */
function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "true";
  } catch {
    return false;
  }
}

/** Initialize analytics. Call once at app startup. */
export function initAnalytics(): void {
  if (!MIXPANEL_TOKEN || initialized) return;

  try {
    mixpanel.init(MIXPANEL_TOKEN, {
      debug: import.meta.env.DEV,
      track_pageview: false, // We track custom events, not page views
      persistence: "localStorage",
      ip: false, // Don't resolve IP to geolocation
      property_blacklist: ["$city", "$region"],
    });

    // Respect DNT/GPC browser signals
    if (browserSignalsDNT() || isOptedOut()) {
      mixpanel.opt_out_tracking();
    }

    // Set super properties (attached to every event)
    mixpanel.register({
      platform: detectPlatform(),
      app_version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown",
    });

    initialized = true;
  } catch {
    // Analytics must never crash the app.
  }
}

/** Track an event. Safe no-op if not initialized or opted out. */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    mixpanel.track(event, properties);
  } catch {
    // Silent fail.
  }
}

/** Identify a user by their anonymous ID (UUID). No PII. */
export function identifyUser(userId: string): void {
  if (!initialized) return;
  try {
    mixpanel.identify(userId);
  } catch {
    // Silent fail.
  }
}

/** Reset identity on logout. */
export function resetUser(): void {
  if (!initialized) return;
  try {
    mixpanel.reset();
  } catch {
    // Silent fail.
  }
}

/** Opt out of analytics tracking. */
export function optOut(): void {
  try {
    localStorage.setItem(OPT_OUT_KEY, "true");
    if (initialized) mixpanel.opt_out_tracking();
  } catch {
    // Silent fail.
  }
}

/** Opt back in to analytics tracking. */
export function optIn(): void {
  try {
    localStorage.removeItem(OPT_OUT_KEY);
    if (initialized) mixpanel.opt_in_tracking();
  } catch {
    // Silent fail.
  }
}

/** Check if user is currently opted out. */
export function isAnalyticsOptedOut(): boolean {
  return isOptedOut();
}

function detectPlatform(): "desktop" | "web" | "mobile" {
  if (typeof window === "undefined") return "web";
  // Electron desktop app
  if ("ipc" in window && typeof (window as Record<string, unknown>).ipc === "object") {
    return "desktop";
  }
  // Capacitor mobile app
  if ("Capacitor" in window) {
    return "mobile";
  }
  return "web";
}
