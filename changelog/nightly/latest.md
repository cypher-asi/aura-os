# Analytics integrity and feature-health observability take shape

- Date: `2026-06-15`
- Channel: `nightly`
- Version: `0.1.0-nightly.669.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.669.1

Today's nightly is heavy on reliability plumbing: the team rebuilt analytics into a contract-enforced pipeline across web, desktop, and mobile, and reshaped feature-health probes so each check declares which runtime it actually exercised. Two follow-up fixes tightened release guards against dirty builds and aligned live probe fixtures with the new expectations.

## 1:40 AM — Feature health split from runtime evidence in status probes

Observability now distinguishes user-facing feature health from the specific runtime (production-api, desktop-release, local-dev) that produced each piece of evidence.

- Status checks now declare a runtime environment alongside the feature they prove, so the dashboard can label rows by runtime and treat production-auth media probes as informational while desktop-release remains the source of truth for Media Generation. (`6b9c8b0`)
- Reworked status policy, investigator, repairer, and StatusView to group checks by feature and reflect the new feature/runtime split, with refreshed docs in aura-feature-health.md and added policy tests. (`6b9c8b0`)
- Release-nightly and release-stable desktop legs now also probe image-generation-stream, extending the desktop-release coverage beyond auth, orgs, and local agents. (`6b9c8b0`)

## 9:52 AM — Analytics rebuilt for accurate True DAU with a CI contract gate

A new typed event registry, server-only session_active emitter, and build-time guards make analytics a hard release requirement across web, desktop, iOS, and Android.

- Introduced a typed analytics registry plus AST/pipeline/server contract tests so renaming, dropping, or non-literal track() calls fail loudly instead of silently breaking metrics. (`57b077e`)
- Moved session_active to a single server-side emitter and updated the Mixpanel server module to enforce the single-emitter and manifest invariants via cargo tests. (`57b077e`)
- iOS and Android fastlane release lanes now require VITE_MIXPANEL_TOKEN and run --require-analytics validation, so TestFlight and Play Store builds can no longer ship with a no-op browser SDK. (`57b077e`)
- Added a dedicated Analytics Contract GitHub workflow that runs on every push to main and PR touching the interface or server, gating regressions on both client and server analytics. (`57b077e`)

## 12:40 PM — Dirty frontend builds blocked and probe coverage broadens to notes and public content

Vite now refuses to produce analytics-enabled bundles with empty, 0.0.0, or -dirty versions, while feature-health probes pick up notes, processes, billing transactions, and public content details.

- Vite analytics-enabled builds and the desktop-frontend-assets validator now reject APP_VERSION values that are empty, 0.0.0, or end in -dirty, closing the gap where a mis-versioned web bundle could ship past the previous release guard. (`5d7fff8`)
- Greatly expanded feature-health probe coverage with a 552-line addition to run-status-probes.mjs and new expectations for org-tool-actions-contract, billing-account-transactions, notes-crud, public-content-details, and analytics-contract-artifacts. (`d58f85f`)
- Desktop release probes now exercise desktop-update-runtime, project-agent-chat-stream, session-share public reads, harness memory/skills roundtrips, notes CRUD, and a full process-run lifecycle, materially deepening what each desktop release leg verifies. (`d58f85f`)
- Notes API now accepts the frontend's camelCase folderId, backed by a serde test, fixing a quiet contract mismatch the new notes-crud probe would otherwise surface. (`d58f85f`)

## 3:46 PM — Live probe fixtures aligned with new process-run and share expectations

A follow-up tightens the process-run lifecycle probe to construct a real runnable graph and waits for share messages to materialize before asserting.

- The process-run-lifecycle probe now builds a proper agent + ignition + action + connection graph and reports agentId, ignitionNodeId, actionNodeId, and connectionId as required evidence, matching the new check expectations. (`dfbc1b6`)
- Session-share public reads now poll with a 30s budget instead of asserting immediately, eliminating a race where the public endpoint returned 404 or empty messages before propagation. (`dfbc1b6`)

## Highlights

- Analytics contract enforced across web, desktop, iOS, and Android builds
- Feature health now separated from runtime evidence in observability
- Dirty/0.0.0 frontend builds now fail loudly at release time
- Expanded desktop and production probes cover notes, processes, and public content

