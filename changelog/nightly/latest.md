# Observability pipeline gets a truthful, persistent status story

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.657.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.657.1

Today was a deep, end-to-end pass on Aura's status and observability stack. The team tightened what probes actually run after a release, locked down the permissions probe agents use, added a persistent run history backed by Aura storage, and collapsed the published status snapshot down to a single source of truth. Release workflows on macOS, Linux, and Windows also got safer defaults for service URLs and more resilient artifact polling.

## 12:10 AM — Complete health suite + resilient artifact polling

Observability workflows now exercise the full check catalog, and the GitHub artifact wait script tolerates transient fetch failures.

- Re-enabled the complete observability check list (including model3d, video generation, and live benchmark probes) across the scheduled workflow and desktop release lanes, gated on whether desktop probes actually ran via a new `ran` step output. (`71be72f`)
- Hardened CI artifact polling to retry transient fetch failures instead of failing the whole release wait step. (`5f1e3a7`)

## 1:16 AM — Safe default service URLs for desktop CI

Desktop validate, performance benchmark, and nightly/stable release workflows now fall back to known-good production service URLs when the corresponding GitHub Actions variables are unset.

- Added `||` defaults for AURA_NETWORK_URL, AURA_STORAGE_URL, AURA_INTEGRATIONS_URL, AURA_ROUTER_URL, Z_BILLING_URL, ORBIT_BASE_URL, and SWARM_BASE_URL across desktop validate, perf benchmark, and the nightly/stable release packagers, so missing repo variables no longer leave builds pointing at empty service endpoints. (`f82c98f`)

## 5:56 AM — Post-release observability re-run

The scheduled observability workflow now re-fires after Desktop Nightly and Stable releases finish, replacing the previous merge-and-carry-forward dance.

- Wired `aura-observability` to a `workflow_run` trigger on Desktop Nightly and Stable Release completion, and dropped the gh-pages `previous snapshot` merge step from the desktop release workflows in favor of a fresh full-suite refresh. (`45c287f`)
- Made the local-agent runtime probe loop continue on per-model failures so one bad model no longer aborts the rest of the matrix. (`45c287f`)

## 10:28 AM — Honest, scoped, regression-aware status probes

A multi-step pass made the status page reflect reality: probes now use real agent permissions, run with a minimal org-scoped, zero-capability bundle, and a new regression suite catches snapshot drift.

- Status probes now forward real `agent_permissions` into the runtime session config and dropped frame-stream/benchmark checks that didn't reflect production behavior, so the published status reflects what users actually experience. (`1d96402`)
- Extracted a single `statusProbeAgentPermissions` helper that scopes probe agents to one org with zero capabilities, and preserved that scoped/zero-capability bundle through the agent create handler with new server-side tests. (`573e753`, `086a496`, `115a761`)
- Added a `local-agent-permissions` desktop check and a `published-observability-snapshot` regression eval that validates the workflow-published snapshot the React `/observability` page consumes, plus a `paymentRequiredHeaderPresent` assertion on the x402 payment challenge probe. (`240d4b2`)
- Reworked release snapshot publishing to preserve the full status snapshot coming out of releases via a dedicated `build-status-snapshot` step and refreshed `check-expectations.json`. (`1bb31b2`)

## 5:21 PM — Persistent observability run history

Each scheduled and desktop release status run now POSTs its snapshot to Aura storage, giving internal tooling a queryable history of features, checks, latency, and failure evidence.

- Introduced `status:persist`, backed by a new `status-persistence` library that builds an `/internal/observability/runs` ingest payload (source, environment, git sha/branch, workflow, release channel, totals) and posts the generated snapshot to Aura storage when `AURA_STORAGE_URL` and `AURA_STORAGE_INTERNAL_TOKEN` are configured. (`7719167`)
- Hooked persistence into the scheduled observability workflow and the macOS aarch64 desktop nightly and stable release jobs, tagged with `desktop-nightly-release` / `desktop-stable-release` sources and channel metadata; failures are best-effort so they cannot block the public snapshot from publishing. (`7719167`)

## 7:45 PM — One snapshot source for /observability

The published observability snapshot is now the single source of truth, eliminating the bundled 800-line fallback that could drift from reality.

- Deleted the 806-line bundled `interface/public/observability/status.json` and pointed the React `StatusView` solely at the workflow-published snapshot, falling back to an explicit unknown state when the fetch fails instead of reading a stale local copy. (`56be76b`)
- Made the observability and desktop release workflows publish straight from `infra/evals/reports/status/status.json`, dropped the now-redundant `continue-on-error` on history persistence, and set `AURA_STATUS_PERSIST_REQUIRED=1` so a persistence failure is now a real signal. (`56be76b`)

## Highlights

- Status probes now run the full suite after every desktop release
- Probe agents are scoped to org with zero capabilities by default
- Persistent observability history wired into Aura storage
- Single published snapshot drives the /observability page

