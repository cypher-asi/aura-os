# Observability gets honest, scoped, and historical

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.656.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.656.1

Today's nightly is almost entirely an observability and release-infrastructure day. The status pipeline was overhauled to run a complete suite after every desktop release, drop probes that weren't actually exercising production paths, scope probe agents to least-privilege permissions, and finally persist a queryable history of runs to internal storage.

## 12:10 AM — Complete health-check suite and resilient artifact polling

Early-morning fixes broadened the observability suite back to a full run and made cross-job artifact polling tolerant of transient GitHub fetch errors.

- Restored the full set of public and generation-stream checks (including model3d-generation-stream and video-generation-stream) in the observability workflow and across nightly/stable release pipelines, so health snapshots reflect the real surface area again. (`71be72f`)
- Added retry-with-backoff to the GitHub artifact polling script so transient fetch failures during release waits no longer abort CI jobs. (`5f1e3a7`)

## 1:16 AM — Default service URLs for desktop CI lanes

Desktop validation, benchmark, and release workflows now fall back to known-good production service URLs when repository variables are unset, eliminating a class of empty-env CI failures.

- AURA_NETWORK_URL, AURA_STORAGE_URL, AURA_INTEGRATIONS_URL, AURA_ROUTER_URL, Z_BILLING_URL, ORBIT_BASE_URL, and SWARM_BASE_URL now default to their hosted endpoints across desktop-validate, ci-performance-benchmark, release-nightly, and release-stable when the workflow variable is missing. (`f82c98f`)

## 5:56 AM — Auto-refresh observability after every desktop release

The observability workflow now triggers automatically on completion of Desktop Nightly and Desktop Stable releases, and desktop snapshot building no longer depends on a fragile gh-pages merge step.

- Added a workflow_run trigger so observability re-runs the full probe suite immediately after a successful Desktop Nightly or Desktop Stable release. (`45c287f`)
- Simplified release-side snapshot building by dropping the previous-snapshot fetch-and-merge dance, and made the local model runtime check record per-model failures instead of aborting the whole batch. (`45c287f`)

## 10:28 AM — Truthful probes with least-privilege probe agents

A multi-step thread made status probes actually exercise the runtime they claim to test and locked probe-created agents down to org-scoped, zero-capability permissions without breaking real agent creation.

- Runtime sessions now forward agent permissions end-to-end, and unreliable model3d/video/live-benchmark/harness-fixture checks were removed from the suite so the dashboard reflects what is genuinely exercised. (`1d96402`)
- Extracted a shared statusProbeAgentPermissions helper that scopes probe agents to a single org with no capabilities, and added a registry test ensuring the runner can't expose unregistered checks. (`573e753`, `086a496`)
- Fixed a regression in the agent create handler so scoped, zero-capability permission bundles round-trip correctly, with a new test covering the org-scoped no-capability case. (`115a761`, `086a496`)

## 2:43 PM — Regression-focused evals and merged release snapshots

Status evals gained a published-snapshot regression check and a new local-agent-permissions check, and desktop release jobs now run the production web probes too and merge them with the prior gh-pages snapshot before publishing.

- Added a published-observability-snapshot check that validates the workflow-published JSON the React /observability page prefers, plus a local-agent-permissions check asserting org-scoped, zero-capability bundles. The x402 payment-challenge check now also requires the 402 response header. (`240d4b2`)
- Desktop nightly and stable release jobs now run the full production web/API probe suite into the same checks directory before snapshot build, and reintroduce the previous-snapshot merge so release-triggered snapshots carry forward fresh website, API, and desktop-only evidence in one publish. (`240d4b2`, `1bb31b2`)

## 5:21 PM — Persisted observability history to aura-storage

A new internal pipeline posts each observability run to aura-storage so the team finally has a queryable history of features, checks, latency, and failure evidence beyond the latest snapshot.

- Introduced status:persist with a new status-persistence library and persist-status-history script that build an ingest payload from the snapshot and POST it to aura-storage's /internal/observability/runs endpoint, gated on AURA_STORAGE_URL and an internal token. (`7719167`)
- Wired the persist step into the scheduled observability workflow and into desktop nightly/stable release jobs as a best-effort, continue-on-error stage tagged with environment, source, and release channel, so persistence failures never block the public status page. (`7719167`)

## Highlights

- Status probes now run a full, truthful suite after each desktop release
- Probe-created agents are scoped to org-only, zero-capability permissions
- Observability runs are now persisted to aura-storage for historical querying
- CI workflows fall back to sane default service URLs when vars are unset

