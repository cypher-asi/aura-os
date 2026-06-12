# Observability probes get honest, scoped, and release-aware

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.654.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.654.1

Today's nightly is an end-to-end overhaul of Aura's status observability stack. The team tightened which checks run, made probes truthful about what they actually exercise, locked down probe agent permissions on the server, and wired the observability suite to refresh automatically after desktop releases. CI also got more resilient against flaky GitHub artifact polling and missing service URL configuration.

## 12:10 AM — Full status suite runs and CI artifact polling survives transient failures

The observability workflow began running the complete health check catalog, and CI's GitHub artifact poller learned to recover from 5xx and network errors.

- Expanded the scheduled observability run to cover the full check catalog (including model3d-generation-stream and video-generation-stream) and pruned stale expectations and snapshot entries so the published status reflects what's actually probed. (`71be72f`)
- Hardened the GitHub artifact wait script with a RetryableGitHubApiError path so transient fetch failures, 429s, and 5xx responses back off and retry instead of failing the release pipeline. (`5f1e3a7`)

## 1:16 AM — Default service URLs for desktop and release workflows

Release, desktop-validate, and performance benchmark workflows now fall back to known-good service URLs when repo variables are unset, removing a class of empty-env CI failures.

- Added default values for AURA_NETWORK_URL, AURA_STORAGE_URL, AURA_INTEGRATIONS_URL, AURA_ROUTER_URL, Z_BILLING_URL, ORBIT_BASE_URL, and SWARM_BASE_URL across nightly, stable, desktop-validate, and performance benchmark workflows so jobs no longer launch with blank service endpoints. (`f82c98f`)

## 5:56 AM — Observability suite re-runs after each desktop release

The observability workflow now triggers on completed desktop releases and the per-release desktop snapshot publishes directly instead of merging against gh-pages.

- Wired the observability workflow to run on workflow_run completions of Desktop Nightly Release and Desktop Stable Release, so the published status refreshes immediately after a successful release instead of waiting for the next 30-minute cron. (`45c287f`)
- Simplified the desktop release lanes to build and publish their snapshot directly, and made the local-agent runtime probe record per-model failures instead of aborting the whole sweep on the first error. (`45c287f`)

## 10:28 AM — Truthful status probes with org-scoped, zero-capability agents

Status probes were rewritten to exercise real runtime paths, run under minimal scoped permissions, and survive a network response that drops the submitted permissions bundle.

- Dropped status checks that weren't actually exercising the claimed runtime path (model3d-generation-stream, video-generation-stream, live-benchmark-hello-world, harness-fixture-suite) and made the local-agent runtime config forward real agent permissions so the probe reflects deployed behavior. (`1d96402`)
- Introduced statusProbeAgentPermissions to scope every probe agent to a single org with an empty capability list, and added unit coverage plus a runner-registry guard to prevent unregistered checks from sneaking in. (`573e753`, `086a496`)
- Added a server-side fallback in agent create so when aura-network's response omits the submitted permissions, the local agent still retains the scoped, zero-capability bundle the client sent (with a warning log for visibility). (`115a761`)

## 2:43 PM — Regression evals for published snapshots and local agent permissions

A new published-observability-snapshot check validates the workflow-published JSON the React status page reads first, and a local-agent-permissions check asserts that probe agents persist as org-scoped with zero capabilities.

- Added a published-observability-snapshot status check and updated the /observability React route to prefer the workflow-published snapshot, falling back to the bundled status.json and finally to an explicit unknown state. (`240d4b2`)
- Introduced a local-agent-permissions desktop release check that asserts probe agents come back org-scoped with empty project/agent scopes and zero capabilities, and tightened the public x402 payment challenge check to require the 402 header is present. (`240d4b2`)

## Highlights

- Status probes now reflect real behavior
- Probe agents run with org-scoped, zero-capability permissions
- Observability refreshes after every desktop release
- CI artifact polling and service URLs are more resilient

