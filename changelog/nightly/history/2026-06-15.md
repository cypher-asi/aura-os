# Sharper feature health signals and a hardened analytics pipeline

- Date: `2026-06-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.672.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.672.1

Today's nightly is dominated by observability and analytics groundwork: Aura's feature-health system learned to tell user-facing capabilities apart from the runtimes that prove them, the analytics pipeline got a contract-tested rebuild with build-time guards across web, desktop, and mobile, and a string of late-day fixes tightened how release probes exercise scheduled processes, public shares, and image generation streams.

## 1:40 AM — Feature health split from runtime evidence

Aura's status system now models feature capability and runtime environment as separate axes, so a check can be informational for one runtime while still proving the feature elsewhere.

- Introduced a runtime-environment axis (production-api, desktop-release, local-dev) alongside feature health, with the status dashboard grouping checks by feature and labeling each row with the runtime it actually exercised. (`6b9c8b0`)
- Reworked Media Generation so desktop-release is the required product proof (with image-generation-stream added to the desktop check matrix) while the production-auth stream remains informational, and updated the feature-health docs to match. (`6b9c8b0`)
- Tightened the status policy library with new investigation packets, verifiers, and policy tests so checks can't be registered without both an expected-output contract and a runner branch. (`6b9c8b0`)

## 9:52 AM — Analytics pipeline rebuilt with a CI contract gate

A ground-up analytics rework gives Aura accurate True DAU, retention, and reliability signals, backed by a typed event registry, server-side single-emitter invariants, and build-time guards on every shipping client.

- Moved session_active to a single server-side emitter and added a typed event registry with AST, pipeline, and server contract tests so a renamed, dropped, or non-literal tracked event now fails CI instead of silently breaking metrics. (`57b077e`)
- Added a dedicated Analytics Contract workflow that runs on pushes and PRs touching the interface or server, plus build-time VITE_MIXPANEL_TOKEN and APP_VERSION guards wired into Android, iOS, desktop, and nightly/stable release lanes. (`57b077e`)
- Fixed the desktop local-server token plumbing and added mobile chat input tracking so store-shipped iOS and Android builds actually report engagement instead of no-opping. (`57b077e`)

## 12:40 PM — Dirty frontend builds blocked and feature health coverage widened

A midday pair of changes hardened release validation against mis-versioned web bundles and expanded the set of features the observability suite verifies end-to-end.

- The Vite build and desktop-frontend-assets validator now refuse to ship analytics-enabled bundles when APP_VERSION is empty, 0.0.0, or a *-dirty git fallback, closing a gap where Render deploys could quietly ship mis-versioned analytics. (`5d7fff8`)
- Expanded feature-health coverage with new checks for notes CRUD, billing account transactions, org tool action contracts, public content detail resolution, analytics contract artifacts, desktop update runtime, project agent chat streams, session share public reads, harness memory and skills roundtrips, and process run lifecycles across nightly and stable release workflows. (`d58f85f`)
- Taught the notes API to accept camelCase folderId payloads from the frontend, unblocking the new notes-crud probe. (`d58f85f`)

## 3:46 PM — Scheduled process runs and session shares fixed in release probes

A late-afternoon sweep aligned the new desktop-release probes with how scheduled processes and public shares actually behave, surfacing real bugs in the harness path along the way.

- Scheduled process runs now resolve the action node's agent and propagate its model (falling back to the latest frontier model) to the harness automaton, so triggered runs no longer launch without a model selection. (`23a7506`)
- The process-run-lifecycle probe now builds a runnable graph with an agent, ignition node, action node, and connection before triggering, and its assertions require all of those IDs as evidence. (`dfbc1b6`)
- Public session-share reads now poll until messages appear and route through a dedicated public API origin (AURA_STATUS_PUBLIC_API_BASE_URL), fixing flakey 404s and origin mismatches on the desktop-release lane. (`dfbc1b6`, `e7b1227`)

## 8:38 PM — Sparse image generation streams no longer trip the watchdog

Late-night fixes made the image generation pipeline and its status surface resilient to long, sparse SSE streams from GPT Image renders.

- Raised the generation event idle timeout from 120s to 300s so GPT Image renders that emit only a handful of progress events over 2-3 minutes are no longer killed mid-render, while the SSE heartbeat keeps the UI alive between events. (`25f77c7`)
- Status probes now summarize SSE frame types and byte sizes and capture the desktop harness sidecar log as an artifact, making failed image-generation checks far easier to diagnose. (`25f77c7`)
- Reworked the marketing StatusView with a pending-investigation treatment and refreshed styles so users see clearer state when a feature health check is still being investigated. (`25f77c7`)

## Highlights

- Feature health now separates capability from runtime evidence
- Analytics rebuilt with a CI contract gate across web, desktop, iOS, and Android
- Dirty or unversioned frontend builds now fail loudly
- Image generation probes tolerate sparse SSE streams
- Scheduled process runs propagate the agent's model end-to-end

