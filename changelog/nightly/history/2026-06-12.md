# Observability probes get truthful, scoped, and release-aware

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.655.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.655.1

Today was a deep iteration day on Aura's status and observability pipeline. The team tightened which checks actually run, made probe agents enforce least-privilege permissions end to end, and rewired desktop releases so they publish a complete, merged status snapshot that the public observability dashboard reads first. CI also got more resilient defaults so jobs no longer break when service URL variables are unset.

## 12:10 AM — Complete health suite and resilient artifact polling

Status probes were broadened to cover the full feature set, and CI artifact polling no longer fails the run on transient fetch errors.

- Expanded the observability workflow to run the complete check list, including 3D and video generation streams, and gated desktop release probes behind a `ran` output so dependent publish steps only fire when probes actually executed. (`71be72f`)
- Hardened `wait-gh-artifacts` so transient GitHub API fetch failures during artifact polling are retried instead of aborting the release job. (`5f1e3a7`)

## 1:16 AM — Default service URLs for desktop and release workflows

CI workflows now fall back to known production service URLs when repository variables are unset, eliminating a class of empty-env failures.

- Performance benchmark, desktop validate, and nightly/stable release workflows now default `AURA_NETWORK_URL`, `AURA_STORAGE_URL`, `AURA_INTEGRATIONS_URL`, `AURA_ROUTER_URL`, `Z_BILLING_URL`, `ORBIT_BASE_URL`, and `SWARM_BASE_URL` to their production endpoints when the corresponding `vars.*` are missing. (`f82c98f`)

## 5:56 AM — Post-release status refresh and model-matrix fault tolerance

Observability now auto-refreshes after each desktop release, and per-model runtime checks no longer fail the entire status run on a single bad model.

- Added a `workflow_run` trigger so the observability workflow runs the full suite automatically after Desktop Nightly and Stable releases complete successfully. (`45c287f`)
- Simplified the desktop release publish path to a single `status:snapshot` step and made the model-matrix probe catch per-model errors so one failing model is reported as `ok: false` instead of aborting the run. (`45c287f`)

## 10:28 AM — Probe agents pinned to org-scoped, zero-capability permissions

Status probes were made honest about what they exercise: the agent runtime now forwards real agent permissions, and probe agents are created with a strict org-scoped, capability-free bundle that is preserved end to end.

- Runtime sessions now forward each agent's permissions into `SessionConfig` via a new `runtime_session_config` helper, so model-matrix and runtime probes reflect actual agent capabilities instead of an empty default. (`1d96402`)
- Introduced a shared `statusProbeAgentPermissions` helper plus a `local-agent-permissions` check, and trimmed the probe runner so probe agents are always created with `{ orgs: [orgId], capabilities: [] }` and verified against that contract. (`086a496`, `573e753`)
- Server-side agent creation now falls back to the submitted permissions when aura-network's create response fails to echo them, logging a warning instead of silently dropping the caller's scoped, zero-capability bundle. (`115a761`)
- Retired stale stream and harness expectations (`model3d-generation-stream`, `video-generation-stream`, `live-benchmark-hello-world`, `harness-fixture-suite`) and added a registry test that rejects runner checks not present in the registry. (`086a496`, `1d96402`)

## 2:43 PM — Release-driven web probes and merged snapshot for /observability

Desktop releases now also run the full production web probe suite and publish a merged status snapshot that the public `/observability` page reads as the source of truth.

- Added a `published-observability-snapshot` regression check and updated the React `/observability` route to fetch the workflow-published snapshot first, falling back to the bundled build-time JSON only if the published one is unreachable. (`240d4b2`)
- Extended desktop release expectations with a new `local-agent-permissions` check and tightened the x402 payment-challenge probe to require the `paymentRequiredHeaderPresent` evidence field. (`240d4b2`)
- Nightly and stable release jobs now run the full production web probe set (api-health, auth, billing, marketplace, x402, marketing pages, and more) alongside the desktop probes, and rebuild the snapshot by merging the previous `gh-pages` status with the freshly captured checks before publishing. (`1bb31b2`, `240d4b2`)

## Highlights

- Status probes now run the full health suite and survive transient artifact fetch failures
- Desktop releases auto-trigger an observability refresh and publish a merged snapshot
- Probe agents are pinned to org-scoped, zero-capability permissions across server and client
- Production web probes now run alongside desktop release probes for a unified snapshot

