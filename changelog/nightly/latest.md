# Sharper analytics signals for sessions and checkout

- Date: `2026-05-05`
- Channel: `nightly`
- Version: `0.1.0-nightly.460.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.460.1

A focused analytics-instrumentation day: the desktop app now emits a clearer daily-active session signal at sign-in, and purchase funnel events have been renamed to honestly reflect checkout intent rather than completed payments.

## 3:33 AM — Honest analytics for sessions and checkout funnels

The app shell now identifies the user and fires a session_active event once per signed-in session, while credits and subscription tracking calls were renamed to make clear they mark checkout start, not a completed purchase.

- Added a per-user session_active analytics event in AppShell that fires once after onboarding hydration, paired with identifyUser, giving DAU metrics a reliable signal instead of inferring activity from unrelated events. (`25abb62`)
- Renamed the credits modal's `credits_purchased` event to `credits_checkout_started` and the tier modal's `subscription_started` to `subscription_checkout_started`, so funnel dashboards no longer overcount Stripe redirects as completed conversions. (`32f8ad0`)

## Highlights

- Accurate DAU tracking via a new session_active event
- Credits and subscription events renamed to reflect checkout intent

