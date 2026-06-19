/**
 * Product analytics wrapper (Mixpanel).
 *
 * Anonymous by default — user ID is a UUID, no emails/names/prompts.
 * Coarse geolocation ($country_code/$region/$city) is resolved by
 * Mixpanel from the request IP at ingestion (see `ip: true`) so events
 * can be broken down by location.
 * Opt-out via localStorage toggle. Respects DNT/GPC browser signals.
 * Safe no-op when token is unset (dev/preview) or user opts out.
 */

import mixpanel from "mixpanel-browser";

import { getAppPlatform, getAppVersion } from "./build-info";
import type { AnalyticsEventName } from "./analytics-registry";

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

/**
 * Boil the browser's "who sent you" signals down to one clean acquisition
 * label. An explicit `utm_source` always wins (campaign tagging is
 * intentional); otherwise we map the referring domain to a known source,
 * keep the site's own domain for any other referrer, and return `direct`
 * when there's no referrer at all (typed URL, or a client that stripped it).
 */
export function classifyAcquisitionSource(referrer: string, search: string): string {
  try {
    const utm = new URLSearchParams(search).get("utm_source");
    if (utm?.trim()) return utm.trim().toLowerCase();
  } catch {
    // Malformed query string — fall through to the referrer.
  }

  if (!referrer) return "direct";

  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "direct";
  }

  const from = (...domains: string[]) =>
    domains.some((d) => host === d || host.endsWith(`.${d}`));

  if (from("x.com", "twitter.com", "t.co")) return "x";
  if (/(^|\.)google\./.test(host)) return "google";
  if (from("youtube.com", "youtu.be")) return "youtube";
  if (from("reddit.com")) return "reddit";
  if (from("github.com")) return "github";
  if (from("linkedin.com", "lnkd.in")) return "linkedin";
  if (from("facebook.com", "fb.com")) return "facebook";
  if (from("news.ycombinator.com")) return "hackernews";

  // Any other referrer keeps its real domain rather than collapsing into a
  // generic bucket, so an unlisted source (a blog, Product Hunt, a
  // newsletter) is still attributable without cross-referencing the raw
  // Mixpanel referrer property.
  return host;
}

/** Initialize analytics. Call once at app startup. */
export function initAnalytics(): void {
  if (!MIXPANEL_TOKEN || initialized) return;

  try {
    mixpanel.init(MIXPANEL_TOKEN, {
      debug: import.meta.env.DEV,
      track_pageview: false, // We track custom events, not page views
      persistence: "localStorage",
      // Let Mixpanel resolve $country_code / $region / $city from the
      // request IP at ingestion so events (e.g. user_signed_up) can be
      // broken down by location. IP is used transiently for geo lookup
      // and is not persisted as an event property by the SDK.
      ip: true,
    });

    // Respect DNT/GPC browser signals
    if (browserSignalsDNT() || isOptedOut()) {
      mixpanel.opt_out_tracking();
    }

    // Set super properties (attached to every event)
    mixpanel.register({
      platform: getAppPlatform(),
      app_version: getAppVersion(),
      is_authenticated: false,
    });

    // First-touch acquisition source: read the browser's referrer + any
    // campaign tag on this first load, classify it, and stamp it ONCE so it
    // survives return visits and rides on every client event (lets us break
    // signups / engaged actions down by where the user came from).
    if (typeof document !== "undefined" && typeof window !== "undefined") {
      mixpanel.register_once({
        acquisition_source: classifyAcquisitionSource(
          document.referrer,
          window.location.search,
        ),
      });
    }

    initialized = true;
  } catch {
    // Analytics must never crash the app.
  }
}

/** Update a super property (attached to all future events). */
export function registerProperty(key: string, value: unknown): void {
  if (!initialized) return;
  try {
    mixpanel.register({ [key]: value });
  } catch {
    // Silent fail.
  }
}

/** Track an event. Safe no-op if not initialized or opted out. */
export function track(event: AnalyticsEventName, properties?: Record<string, unknown>): void {
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
    mixpanel.register({ is_authenticated: true });
    // Mirror the first-touch source onto the user PROFILE (set_once) so
    // server-emitted events like session_active — which never carry client
    // super-properties — can still be broken down by acquisition source
    // (True DAU / retention by source).
    const source = mixpanel.get_property("acquisition_source");
    if (typeof source === "string" && source) {
      mixpanel.people.set_once({ acquisition_source: source });
    }
  } catch {
    // Silent fail.
  }
}

/** Reset identity on logout. */
export function resetUser(): void {
  if (!initialized) return;
  try {
    mixpanel.reset();
    mixpanel.register({ is_authenticated: false });
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
