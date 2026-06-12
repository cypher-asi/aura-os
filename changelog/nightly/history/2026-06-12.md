# Sharper observability signal and steadier release CI

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.649.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.649.1

Today's nightly focused on the plumbing behind Aura's release pipeline: the desktop release workflow now produces a more honest health snapshot, CI gets safer defaults for service URLs, and artifact polling shrugs off transient GitHub API hiccups instead of failing the run.

## 12:10 AM — Expanded health probes and resilient artifact polling

The observability suite was rescoped to cover the generation surfaces that actually matter, and the CI script that waits on GitHub artifacts learned to ride out transient API failures.

- Reshaped the scheduled observability run to drop redundant probes and add 3D model and video generation streams alongside image generation, keeping the public status page focused on the surfaces users actually hit. (`71be72f`)
- Gated desktop release observability publishing on whether credentials were present, so missing AURA_STATUS_USER_EMAIL/PASSWORD now cleanly skip artifact upload and snapshot publish instead of producing empty or misleading status data. (`71be72f`)
- Hardened the GitHub artifact wait script to retry on network errors, 429s, and 5xx responses via a new RetryableGitHubApiError path, so flaky API calls no longer fail release runs outright. (`5f1e3a7`)

## 1:16 AM — Safe default service URLs for desktop CI

Desktop validation, performance benchmarks, and both release workflows now fall back to known-good service endpoints when repo variables are unset.

- Added default fallbacks for AURA_NETWORK_URL, AURA_STORAGE_URL, AURA_INTEGRATIONS_URL, AURA_ROUTER_URL, Z_BILLING_URL, ORBIT_BASE_URL and SWARM_BASE_URL across desktop-validate, performance benchmark, and nightly/stable release workflows, so missing repo vars no longer silently break desktop CI. (`f82c98f`)
- Propagated the same defaults into the cached CACHE_* environment used by the nightly packager, keeping packaged builds aligned with the URLs CI actually validated against. (`f82c98f`)

## 5:56 AM — Post-release observability refresh and per-model probe isolation

Desktop nightly and stable releases now automatically trigger a fresh observability sweep on success, and a single failing model no longer aborts the rest of the runtime probe pass.

- Wired the observability workflow to run on completion of Desktop Nightly Release and Desktop Stable Release (only on success), so the public status page reflects the new build instead of waiting for the next half-hour cron tick. (`45c287f`)
- Dropped the gh-pages snapshot merge step from desktop release workflows in favor of a clean status:snapshot, simplifying the publish path now that the scheduled job owns the full refresh. (`45c287f`)
- Wrapped per-model runtime probes in try/catch so an individual model failure is recorded as a failed result with its error message rather than aborting the entire suite mid-run. (`45c287f`)

## Highlights

- Observability suite now covers 3D and video generation probes
- Desktop releases trigger a fresh full-suite status refresh
- CI artifact polling tolerates GitHub API flakiness

