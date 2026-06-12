# Sharper observability signal across the release pipeline

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.651.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.651.1

Today's nightly was almost entirely about making Aura's status probes and release CI tell the truth. A series of fixes tightened which features are health-checked, hardened artifact polling against transient GitHub failures, wired observability to react to each release, and reshaped how status-probe agents authenticate against the runtime.

## 12:10 AM — Health-check coverage trimmed and CI artifact polling hardened

Early-morning work realigned the observability check set to features that actually exist in production and made the release artifact waiter resilient to flaky GitHub API responses.

- Reworked the observability check list to drop stale probes and add 3D and video generation streams, while removing duplicated public-models coverage so the dashboard reflects the real product surface. (`71be72f`)
- Pinned the desktop release packaging job to the production environment and gated observability upload, snapshot, and publish steps on whether probes actually ran, preventing empty or misleading status updates. (`71be72f`)
- Taught the GitHub artifact waiter to distinguish retryable failures (network errors, 429s, and 5xx responses) from hard errors, so transient API hiccups no longer fail nightly and stable release runs. (`5f1e3a7`)

## 1:16 AM — Desktop service URLs get safe CI defaults

Release and benchmark workflows now fall back to known production service URLs when repository variables are missing, removing a class of empty-config CI breakages.

- Provided default values for AURA_NETWORK_URL, AURA_STORAGE_URL, AURA_INTEGRATIONS_URL, AURA_ROUTER_URL, Z_BILLING_URL, ORBIT_BASE_URL, and SWARM_BASE_URL across the nightly release, stable release, desktop validation, and performance benchmark workflows so unset repo variables no longer break desktop builds. (`f82c98f`)
- Applied the same defaults to the CACHE_* mirror variables used by the updater pipeline, keeping cached release metadata aligned with the live service endpoints. (`f82c98f`)

## 5:56 AM — Observability now reruns after each desktop release

The status suite is no longer tied solely to a 30-minute cron — it now refreshes immediately after a successful Desktop Nightly or Stable release and degrades probe failures gracefully.

- Added a workflow_run trigger so the observability suite re-executes after Desktop Nightly Release and Desktop Stable Release complete successfully, giving each release a fresh post-deploy status snapshot. (`45c287f`)
- Dropped the gh-pages snapshot merging dance from release workflows in favor of a single status:snapshot step, simplifying how desktop release observability is built and published. (`45c287f`)
- Wrapped per-model runtime checks in try/catch so a single failing model is reported as a failed result rather than aborting the entire probe run. (`45c287f`)

## 10:28 AM — Status probes made truthful and least-privilege

Afternoon work made the status probes faithfully represent real agent runtime behavior and stripped their elevated capabilities down to the minimum needed.

- Refactored the agent runtime harness to build its SessionConfig through a dedicated helper that forwards agent permissions, with a regression test confirming InvokeProcess capability propagates correctly into the wire config. (`1d96402`)
- Pared the observability check list down further, removing model3d, video, and live-benchmark hello-world probes that were not reflecting real product flows, and updated the feature-health doc to match. (`1d96402`)
- Replaced the fullAccessAgentPermissions helper with statusProbeAgentPermissions, dropping spawnAgent, controlAgent, generateMedia, and project read/write capabilities so status-probe agents now run with an empty capability set. (`573e753`)

## Highlights

- Status probes now exercise the real production path
- CI artifact polling survives GitHub 5xx and network blips
- Observability re-runs automatically after every desktop release
- Status probe agents downgraded to minimal permissions

