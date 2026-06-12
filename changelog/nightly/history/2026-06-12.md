# Health probes broaden and release pipelines get safer defaults

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.648.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.648.1

A quiet night focused entirely on release plumbing: observability probes were rescoped to cover the right surface area, the artifact-waiter learned to ride out transient GitHub API failures, and desktop release workflows now fall back to known service URLs when repository variables are missing.

## 12:10 AM — Observability probes rescoped and artifact waiter hardened against API blips

Health checks were realigned to the surface area that actually ships, and the CI artifact poller now survives transient GitHub API failures instead of failing the run.

- Expanded the observability probe set to include model3d-generation-stream and video-generation-stream while trimming probes that no longer reflected shipped behavior, and gated desktop release observability steps on whether credentials were actually present so skipped probes no longer publish empty artifacts or snapshots. (`71be72f`)
- Pinned the nightly and stable release `package` jobs to the production environment so signing secrets and release variables resolve from the right scope. (`71be72f`)
- Taught the GitHub artifact waiter to classify network errors, 429s, and 5xx responses as retryable and keep polling instead of aborting the workflow, with deduped status logging so the CI output stays readable during outages. (`5f1e3a7`)

## 1:16 AM — Desktop CI and release workflows fall back to default service URLs

Desktop validation, performance benchmarks, and both nightly and stable release pipelines now substitute known-good service endpoints when repository variables are unset, preventing empty URLs from silently breaking builds.

- Added inline fallbacks for AURA_NETWORK_URL, AURA_STORAGE_URL, AURA_INTEGRATIONS_URL, AURA_ROUTER_URL, Z_BILLING_URL, ORBIT_BASE_URL, and SWARM_BASE_URL across the desktop-validate, performance-benchmark, release-nightly, and release-stable workflows, including the cached values used by the nightly packager. (`f82c98f`)

## Highlights

- Observability probes now cover 3D and video generation streams
- Artifact polling retries through GitHub API blips
- Desktop CI and release workflows have safe default service URLs

