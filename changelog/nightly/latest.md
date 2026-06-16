# Calmer status signals and a forced-upgrade gate that waits its turn

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.678.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.678.1

Today's nightly tightens how Aura's observability stack reasons about outages — fewer false freshness alarms, more focused root-cause investigations — and fixes a sharp edge in the desktop app where a forced-upgrade prompt could cut off an in-progress turn.

## 7:26 AM — Status investigator stops crying wolf

A morning of observability work loosened overly tight freshness thresholds, gave cold model evals more breathing room, and stopped the auto-investigator from inventing commits or noisy suspects.

- Relaxed freshness and latency thresholds across the status probes: api-health, auth-session, and system-info now tolerate up to 30 minutes of staleness, the published observability snapshot is treated as informational with a 6-hour window, and the public-website aggregator stays operational when only that snapshot lags. The scheduled observability workflow was also shifted off the top of the hour to dodge cron contention. (`5a0475f`)
- Gave the model-matrix eval realistic budgets for cold starts — the server-side runtime test timeout moved from 45s to 120s, and the matching status check now warns at 180s and only flags an outage at 360s — so a slow first token no longer registers as a model outage. (`2049590`)
- Hardened the auto-investigator so it can only cite commits, PRs, and file paths that actually appear in the supplied evidence packet; unsupported references in proof, possible causes, reproduction steps, and follow-up probes are now stripped before the report is returned. (`2049590`, `7560151`)
- Source discovery for investigations now prioritizes product code over the observability framework itself, scores needles by specificity (endpoints, error codes, phrases), and drops low-confidence suspect commits — cutting noise in the ranked suspects and candidate paths surfaced to investigators. (`7c8e040`, `7560151`)

## 8:52 AM — Forced-upgrade overlay defers to an active stream

The desktop forced-upgrade gate no longer slams down in the middle of a running turn or extraction; it waits for the app to go idle before latching.

- Introduced a global useIsAnyStreaming() selector and wired it into ForcedUpgradeOverlay so the gate is suppressed while any stream is active and only latches once the user is idle — a defer, not a cancel. If a new stream begins after the gate is already shown, it correctly stays up. (`04c8143`)

## Highlights

- Forced-upgrade overlay no longer interrupts an active stream
- Status checks tolerate slower model runs and snapshot lag
- Investigator only cites commits and files it actually has evidence for

