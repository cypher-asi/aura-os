# Trustworthy signals: feature health and analytics get rebuilt

- Date: `2026-06-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.666.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.666.1

Today's nightly focuses on the signals Aura relies on to know whether the product is actually working. The status dashboard learns to tell feature health apart from the runtime it was observed in, and the analytics pipeline gets a contract-tested rebuild so True DAU, retention, and reliability numbers can be trusted across web, desktop, and mobile.

## 1:40 AM — Status dashboard splits feature health from runtime evidence

The observability stack now treats the user-facing feature and the runtime that exercised it as separate axes, so a desktop-only proof no longer gets confused with a production-API probe.

- Each status check now declares its runtime environment (production-api, desktop-release, local-dev) alongside its feature, and the marketing StatusView groups checks by feature while labeling the runtime per row. (`6b9c8b0`)
- Media Generation is now anchored to the desktop-release lane where the bundled harness actually runs, while the scheduled public workflow can still surface informational production-auth stream health without falsely proving or disproving the feature. (`6b9c8b0`)
- Nightly and stable release workflows pick up an added image-generation-stream desktop check and a new AURA_STATUS_RUNTIME_ENVIRONMENT tag, giving release probes clearer provenance in the published snapshot. (`6b9c8b0`)

## 9:52 AM — Analytics rebuilt around a typed registry and contract CI gate

Aura's metrics pipeline was reworked end to end so True DAU, retention, and reliability numbers stop silently drifting when code changes.

- Client analytics now flow through a typed event registry with AST and pipeline tests that fail the build if an event is renamed, dropped, or passed as a non-literal, and if the client ever stops forwarding events to the Mixpanel SDK. (`57b077e`)
- session_active is now emitted server-side from a single emitter, with Rust tests enforcing the event-name and manifest invariants so True DAU can't be double-counted or quietly lost. (`57b077e`)
- A new Analytics Contract workflow runs the client and server analytics tests on every PR and direct push to main, gating merges the moment tracking would break. (`57b077e`)
- iOS, Android, and desktop release lanes now bake VITE_MIXPANEL_TOKEN into the shipped bundle and hard-fail the build under REQUIRE_ANALYTICS, fixing the case where store-shipped clients silently no-op'd analytics; mobile chat input also picks up missing tracking. (`57b077e`)

## Highlights

- Status dashboard separates feature health from runtime evidence
- Analytics rebuilt with a typed registry and CI contract gate
- Mobile store builds now hard-fail without a Mixpanel token

