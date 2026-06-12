# Status probes get honest, scoped, and release-aware

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.653.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.653.1

Today's nightly is an observability and release-plumbing day. The team tightened how Aura's status probes run, what permissions they request, and how releases trigger health checks — plus made desktop CI more resilient to missing configuration and flaky GitHub API calls.

## 12:10 AM — Full health-check coverage and resilient artifact polling

Early-morning fixes broadened the observability check set and hardened the CI artifact wait script against transient GitHub failures.

- Expanded the observability suite to include 3D and video generation streams alongside the existing image stream, and gated desktop release probe publishing on whether the probes actually ran so missing credentials no longer poison the snapshot. (`71be72f`)
- CI artifact polling (`wait-gh-artifacts.mjs`) now retries on network errors, 429s, and 5xx responses from the GitHub API instead of failing the whole release wait on a single blip. (`5f1e3a7`)

## 1:16 AM — Default service URLs for desktop CI workflows

Desktop validation, performance benchmarks, and nightly/stable release workflows now fall back to known-good service URLs when repository variables are unset.

- Added inline defaults for AURA_NETWORK_URL, AURA_STORAGE_URL, AURA_INTEGRATIONS_URL, AURA_ROUTER_URL, Z_BILLING_URL, ORBIT_BASE_URL, and SWARM_BASE_URL across desktop-validate, performance benchmark, and nightly/stable release workflows, so forks and fresh environments can run end-to-end without pre-seeding every variable. (`f82c98f`)

## 5:56 AM — Observability refreshes automatically after each desktop release

The status suite now reruns on successful Desktop Nightly and Stable releases, and the per-release snapshot was simplified to drop fragile gh-pages merging.

- Wired the observability workflow to trigger on successful completion of Desktop Nightly Release and Desktop Stable Release runs, so the public status page reflects the new build within minutes instead of waiting for the 30-minute cron. (`45c287f`)
- Replaced the merged-with-previous-snapshot dance (which fetched gh-pages mid-release) with a straight `npm run status:snapshot`, and made per-model runtime probe failures recoverable so one bad model no longer aborts the whole sweep. (`45c287f`)

## 10:28 AM — Truthful, least-privilege status probes end-to-end

An afternoon thread reshaped how status probes report and authenticate: probes only claim features they actually exercise, run with minimal permissions, and the agent-create path now preserves those scoped permissions through the network round-trip.

- Status probes no longer advertise 3D, video, live-benchmark, or harness-fixture checks they couldn't verify; the observability workflow and feature registry were pruned to match, and the runtime handler now forwards agent permissions into the session config so probe results reflect the real authorization path. (`1d96402`)
- Status probe agents now request zero capabilities instead of the previous full-access bundle (spawnAgent, controlAgent, invokeProcess, generateMedia, readAllProjects, writeAllProjects, …), and a new `statusProbeAgentPermissions` helper scopes them to a single org with explicit tests. (`573e753`, `086a496`)
- Hardened agent creation so that when aura-network's response drops or rewrites the submitted permissions, the server logs a warning and falls back to the originally requested scoped, zero-capability permissions — preventing probes (and other scoped agents) from silently being upgraded. (`115a761`)

## Highlights

- Status probes now run with least-privilege permissions
- Observability suite re-runs automatically after each desktop release
- Desktop CI falls back to default service URLs when vars are unset
- Artifact polling survives transient GitHub API failures

