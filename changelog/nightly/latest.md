# Analytics integrity and feature-health observability harden the release pipeline

- Date: `2026-06-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.668.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.668.1

Today's nightly is a deep investment in trustworthy telemetry and release-time signal. The team split feature health from runtime evidence in the status dashboard, rebuilt the analytics stack so True DAU and retention can actually be trusted, and tightened the build guards that keep no-op or dirty analytics bundles from ever shipping.

## 1:40 AM — Feature health split from runtime evidence in status dashboard

The observability stack now distinguishes user-facing feature health from the specific runtime that produced each check, so the marketing status view can tell deployment-specific signals apart from product proof.

- Introduced an AURA_STATUS_RUNTIME_ENVIRONMENT axis (production-api, desktop-release, local-dev) across the observability, repair, nightly, and stable workflows, letting each check declare the runtime it actually exercised instead of conflating it with the feature. (`6b9c8b0`)
- Reworked status policy, investigator, and StatusView to group checks by feature, label per-row runtimes, and allow runtime-specific checks to act as informational evidence — for example Media Generation is now proven by the desktop-release lane while production-auth stream health stays informational. (`6b9c8b0`)
- Added image-generation-stream to desktop release probes and refreshed the feature-health docs to explain the new feature-vs-runtime model. (`6b9c8b0`)

## 9:52 AM — Analytics rebuilt for trustworthy True DAU and retention

A ground-up overhaul of the analytics pipeline replaces ad-hoc tracking with a typed registry, a single server-side session emitter, and build- and CI-time guards that fail loudly before mis-instrumented clients reach users.

- Consolidated session_active into a single server-side emitter and introduced a typed analytics event registry, with AST, pipeline, and server contract tests that fail if events are renamed, dropped, or tracked via non-literal names. (`57b077e`)
- Added an Analytics Contract GitHub workflow that runs on every push to main and every PR touching interface or server code, gating merges on the client registry, pipeline, and server Mixpanel invariants. (`57b077e`)
- Made analytics a hard requirement for store builds: Android and iOS fastlane runs now bake VITE_MIXPANEL_TOKEN into the web bundle and set REQUIRE_ANALYTICS=1 so the release lane fails if the SDK would no-op. (`57b077e`)
- Fixed mobile chat input tracking and desktop local-server token handling so engagement events from MobileChatInputBar and the desktop shell are actually attributed. (`57b077e`)

## 12:40 PM — Dirty-build guard and expanded health probes for notes, billing, and content

Afternoon work hardened the analytics build guard against dirty version stamps and broadened the feature-health probe matrix to cover several previously unmonitored product surfaces.

- Vite builds and the desktop-frontend-assets-validate --require-analytics check now reject APP_VERSION values that are empty, 0.0.0, or end in -dirty, so a config regression that would ship a mis-versioned or no-op analytics SDK fails the deploy loudly instead of going unnoticed. (`5d7fff8`)
- Expanded the public observability and release-stable/nightly check matrices with new probes for notes-crud, billing-account-transactions, org-tool-actions-contract, public-content-details, and analytics-contract-artifacts, closing visibility gaps in billing, content, and analytics surfaces. (`d58f85f`)
- Extended the desktop release probe set with desktop-update-runtime, project-agent-chat-stream, session-share-public-read, harness memory/skills roundtrips, notes-crud, and process-run-lifecycle, plus a new run-status-probes.mjs to drive the broader coverage. (`d58f85f`)
- Server notes endpoint now formally accepts the frontend's camelCase folderId payload, with a regression test pinning the contract. (`d58f85f`)

## Highlights

- Feature health and runtime environment are now separate axes in the status dashboard
- Analytics rebuilt around a typed event registry with a CI contract gate
- Release builds now refuse to ship dirty or token-less analytics bundles
- Desktop and public observability probes expanded to cover notes, billing, and content detail endpoints

