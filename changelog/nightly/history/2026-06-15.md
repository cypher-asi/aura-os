# Trustworthy analytics and feature-health signals

- Date: `2026-06-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.667.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.667.1

Today's nightly focuses on making Aura's telemetry and health dashboards honest. The status system now separates what a feature does from where it was exercised, analytics tracking is enforced end-to-end across web, desktop, and mobile builds, and dirty release builds can no longer slip through the deploy gate.

## 1:40 AM — Feature health decoupled from runtime evidence

The observability stack now distinguishes user-facing capabilities from the runtime that produced each check, giving the status dashboard a more honest read on what's actually proven green.

- Status checks now declare a runtime environment (production-api, desktop-release, local-dev) alongside the feature they cover, so the dashboard groups by feature and labels the runtime per row instead of conflating the two. (`6b9c8b0`)
- Media Generation health now treats the desktop-release lane as the required proof and the production-auth stream as informational, reflecting that the bundled harness only exists on desktop. (`6b9c8b0`)
- Desktop release probes on nightly and stable workflows added an image-generation-stream check and now stamp AURA_STATUS_RUNTIME_ENVIRONMENT so artifacts carry runtime provenance. (`6b9c8b0`)

## 9:52 AM — Analytics contract enforced across web, desktop, and mobile

A ground-up rebuild of the analytics pipeline closes the gaps that were producing inaccurate DAU and retention, backed by a new CI contract that fails loudly the moment tracking would silently break.

- Server is now the single emitter for session_active, with a typed event registry and AST/pipeline/server contract tests guarding against renamed, dropped, or non-literal event names. (`57b077e`)
- New Analytics Contract workflow runs on every push to main and on PRs touching interface or server analytics code, gating both client registry tests and server Mixpanel tests. (`57b077e`)
- iOS and Android release lanes now bake VITE_MIXPANEL_TOKEN into the store bundle and require analytics validation, so TestFlight and Play Store builds can no longer ship a no-op browser SDK. (`57b077e`)
- Mobile chat input now emits tracking events and the desktop local-server token path was corrected, closing two known reporting holes. (`57b077e`)

## 12:40 PM — Dirty frontend builds now fail the deploy

The Render and desktop release guards tightened the APP_VERSION check so analytics-enabled builds cannot ship under a git-fallback or unclean version string.

- Vite now asserts a clean APP_VERSION and a present VITE_MIXPANEL_TOKEN at build time when REQUIRE_ANALYTICS is set, refusing release builds whose SDK would no-op. (`5d7fff8`)
- The desktop-frontend-assets validator and Render deploy now reject any APP_VERSION that is empty, 0.0.0, or ends in -dirty, with a regression test covering the dirty-version case. (`5d7fff8`)

## Highlights

- Feature health and runtime environment split into separate axes on the status dashboard
- Hard CI gate for analytics contracts across web, desktop, iOS, and Android
- Dirty or unversioned frontend builds now fail the Render deploy

