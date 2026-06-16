# Analytics rebuild and a sharper feature-health signal

- Date: `2026-06-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.673.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.673.1

Today's nightly is dominated by two long threads: a ground-up rebuild of Aura's product analytics so True DAU, retention, and reliability numbers are trustworthy across web, desktop, and mobile; and a deep rework of the feature-health system so the status dashboard distinguishes user-facing capabilities from the runtime that actually exercised them. Several follow-up fixes hardened scheduled process runs, image-generation streams, and the desktop release probes that gate every nightly build.

## 1:40 AM — Feature health split from runtime evidence on the status page

The observability stack now treats the user-facing capability and the runtime that exercised it as separate axes, so the status dashboard can show a feature as healthy on desktop while flagging the same path as merely informational in production.

- Introduced an explicit AURA_STATUS_RUNTIME_ENVIRONMENT axis (production-api, desktop-release, local-dev) wired through the nightly, stable, and observability workflows, and reflected it in the StatusView UI and feature-health docs so each row labels the runtime it actually proved. (`6b9c8b0`)
- Reworked the status policy, investigator, and repairer libraries to reason about feature vs. runtime separately, with new policy tests and registry coverage so a runtime-specific probe can be informational without dragging a whole feature red. (`6b9c8b0`)
- Added image-generation-stream to the desktop release probe set so Media Generation health is proven against the bundled harness instead of the deployed API. (`6b9c8b0`)

## 9:52 AM — Analytics rebuilt for trustworthy DAU, retention, and reliability

A large analytics overhaul replaces ad-hoc tracking with a single server-side session emitter, a typed event registry, and a CI contract that fails the moment tracking would silently break — across web, Desktop, iOS, and Android release lanes.

- Consolidated session_active to a single server-side emitter and introduced a typed analytics registry with AST, pipeline, and server contract tests, so renamed or dropped events and non-literal track() calls now fail loudly instead of poisoning DAU and retention. (`57b077e`)
- Added a dedicated Analytics Contract GitHub workflow that runs on every push to main and on pull requests, gating both client (registry + pipeline) and server (event constants + single-emitter) invariants before merge. (`57b077e`)
- Made analytics a hard requirement for store and desktop release builds: Android and iOS Fastlane lanes now bake VITE_MIXPANEL_TOKEN into the web bundle and run the --require-analytics validator, and desktop local-server token handling was fixed so the shipped SDK no longer silently no-ops. (`57b077e`)
- Wired mobile chat input tracking through the new registry so the chat composer reports engagement events on iOS and Android via the same contract as web and Desktop. (`57b077e`)

## 12:40 PM — Dirty frontend builds blocked and feature-health probes broadened

Two follow-ups tightened release confidence: Vite and the desktop asset validator now refuse to ship analytics-enabled builds with a *-dirty or 0.0.0 version, and the feature-health probe matrix grew substantially across desktop and production lanes.

- Analytics-enabled Vite builds and the desktop-frontend-assets validator now fail when APP_VERSION is empty, 0.0.0, or ends in -dirty, preventing Render and store deploys from shipping mis-versioned analytics that would corrupt release-over-release metrics. (`5d7fff8`)
- Expanded the observability check matrix with notes-crud, process-run-lifecycle, harness memory/skills roundtrips, project agent chat stream, session share public read, desktop-update-runtime, org-tool-actions-contract, billing account transactions, public content details, and analytics-contract artifacts — both on the desktop release lane and the public observability sweep. (`d58f85f`)
- Added a 552-line run-status-probes module and a notes handler test confirming the create-note API accepts the frontend's camelCase folderId, closing a long-standing gap between client and server contract. (`d58f85f`)

## 3:46 PM — Scheduled process runs now carry the right model end-to-end

A trio of observability fixes made the process-run-lifecycle probe meaningful: scheduled runs resolve the action node's agent model, desktop share probes hit the API origin, and live probe fixtures match what the server actually returns.

- Scheduled process automaton starts now resolve the first action node's agent, derive its effective model (falling back to LATEST_FRONTIER_MODEL), and propagate it through the harness client so triggered runs no longer execute with a missing or stale model. (`23a7506`)
- Rebuilt the process-run-lifecycle probe to construct a runnable graph — agent, ignition node, action node, and connection — and assert all of those IDs as evidence, so the desktop release lane actually proves the end-to-end trigger path instead of just creating an empty process. (`dfbc1b6`, `23a7506`)
- Pointed desktop share probes at the public API origin via AURA_STATUS_PUBLIC_BASE_URL and made the session-share public read wait for messages to land, eliminating a flaky 404 race against the share publication pipeline. (`e7b1227`, `dfbc1b6`)

## 8:38 PM — Sparse image-generation streams no longer trip the watchdog

Late-night fixes raised the image-generation idle timeout to match real GPT Image render cadence and gave the status UI a clearer pending state, so a slow but healthy render is no longer reported as a failure.

- Raised the harness generation event idle timeout from 120s to 300s and aligned the nightly release probe environment (AURA_GENERATION_EVENT_IDLE_TIMEOUT_SECS / STREAM_IDLE_TIMEOUT_SECS = 300) so 2–3 minute GPT Image renders that emit only a handful of progress events are no longer killed mid-stream. (`25f77c7`, `dd42aa3`)
- Image-generation probe evidence now summarizes SSE frame types and byte counts instead of dumping raw frames, and the desktop probe runner copies the harness sidecar log into the artifact bundle for post-mortem debugging. (`25f77c7`)
- StatusView gained a dedicated investigation-pending treatment with refreshed styling and tests, so users see an explicit in-progress state rather than a misleading red when a check is still being diagnosed. (`25f77c7`)

## Highlights

- Analytics rebuilt with a CI contract gate across web, Desktop, iOS, and Android
- Feature health split from runtime evidence on the public status page
- Scheduled process runs now resolve and propagate the correct model
- Image generation streams tolerate sparse progress without false failures

