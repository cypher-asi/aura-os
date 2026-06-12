# Observability probes get honest, scoped, and release-aware

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.652.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.652.1

Today was an infrastructure-heavy day focused on making Aura's status observability trustworthy. The team tightened how health probes run, removed checks that weren't telling the truth, locked down the permissions those probes use, and hardened the release pipeline against flaky GitHub API calls and missing service URLs.

## 12:10 AM — Complete health-check coverage and resilient artifact polling

The observability suite was expanded to cover the full set of release-critical probes, and CI artifact polling stopped failing on transient GitHub API errors.

- Expanded the desktop release observability suite to run the full check list — including 3D and video generation streams — so release health reports reflect the real product surface. (`71be72f`)
- Gated observability publishing on whether the probes actually ran, preventing empty or misleading status snapshots when credentials are missing. (`71be72f`)
- Made the GitHub artifact-wait script retry on network failures, 429s, and 5xx responses instead of aborting the release on a single flaky API call. (`5f1e3a7`)

## 1:16 AM — Default service URLs for desktop and release workflows

Release and validation workflows now ship with safe fallback URLs for every Aura backend service, so builds no longer break when a repository variable is unset.

- Added default values for AURA_NETWORK_URL, AURA_STORAGE_URL, AURA_INTEGRATIONS_URL, AURA_ROUTER_URL, Z_BILLING_URL, ORBIT_BASE_URL, and SWARM_BASE_URL across the nightly release, stable release, desktop validation, and performance benchmark workflows. (`f82c98f`)

## 5:56 AM — Observability re-runs automatically after each desktop release

The observability workflow now triggers on successful desktop nightly and stable releases, and the release pipeline itself was simplified to produce snapshots directly instead of merging against gh-pages.

- Wired the observability workflow to run on completion of Desktop Nightly Release and Desktop Stable Release, so post-release health is refreshed without waiting for the next cron tick. (`45c287f`)
- Replaced the gh-pages merge dance in release workflows with a direct desktop observability snapshot, removing a fragile git fetch step from the critical release path. (`45c287f`)
- Made per-model runtime probes capture errors individually so one failing model no longer aborts the rest of the suite. (`45c287f`)

## 10:28 AM — Truthful, least-privilege status probes

Status probes were rewritten to only report what they can actually verify, to run with the minimum permissions needed, and to forward agent permissions correctly through the runtime.

- Removed the model3d, video, live-benchmark, and harness-fixture checks from the observability run because they couldn't be verified truthfully, and updated feature health docs to match. (`1d96402`)
- Status probe agents are now created with capability-less, org-scoped permissions instead of a full-access capability set — first by zeroing capabilities, then by extracting a dedicated, tested statusProbeAgentPermissions helper that requires an org id. (`573e753`, `086a496`)
- Runtime session config on the server now forwards agent permissions into the harness session, with regression tests ensuring scoped, zero-capability permissions are preserved end to end. (`1d96402`, `086a496`)
- Locked the status check registry so the probe runner cannot expose check IDs that aren't declared, catching drift between the runner and the registered feature list. (`086a496`)

## Highlights

- Status probes now run with minimal, org-scoped permissions
- Observability suite re-runs automatically after every desktop release
- CI artifact polling survives transient GitHub API failures
- Release workflows fall back to safe default service URLs

