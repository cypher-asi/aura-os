# Calmer status signals and sharper outage investigations

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.675.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.675.1

A focused observability day for Aura: the public status surface stops flapping on slow snapshot refreshes, and the tooling that finds the offending code during an incident now ranks product code ahead of the framework itself.

## 7:26 AM — Public status freshness thresholds relaxed and investigation routing improved

Status freshness windows were widened so brief snapshot lag no longer trips a degraded state, and outage investigations now surface product code paths ahead of the status framework's own files.

- Public Website status stays operational when the published observability snapshot ages out: the snapshot check is now informational with a 360-minute staleness window, and freshness budgets for api-health, auth-session, and system-info were unified at 30 minutes so transient lag in the snapshot pipeline no longer flips the public StatusView into a degraded state. (`5a0475f`)
- Snapshot age tolerance on the marketing StatusView was raised from 180 to 300 minutes and the observability workflow cron was nudged from the top of the hour to :17, reducing collisions with other scheduled jobs and false freshness alerts. (`5a0475f`)
- Investigation source discovery now ranks needles by signal quality (API paths, error codes, multi-word phrases, kebab/camel identifiers) and deprioritizes matches inside infra/evals/status itself, so suspected code paths point at the product surface that actually failed rather than the status framework scaffolding. (`7c8e040`)
- Repo search during investigations is more thorough and bounded: needle variants now include extracted phrases and stricter word-boundary code/error tokens, with per-needle match caps replacing the old global cutoff to give every needle a fair shot at producing hints. (`7c8e040`)

## Highlights

- Public status page no longer degrades on stale snapshot metadata
- Investigation source discovery prioritizes product code over status framework internals
- Observability probe schedule shifted off the top of the hour

