# Sharper status investigations and calmer freshness alerts

- Date: `2026-06-16`
- Channel: `nightly`
- Version: `0.1.0-nightly.677.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.677.1

Today's nightly is focused on the observability stack behind Aura's status page: quieter false alarms on freshness, more trustworthy automated investigations, and a runtime probe that no longer trips on cold model starts.

## 7:26 AM — Status page observability hardening

A focused pass on the status eval pipeline reduced noisy freshness failures, tightened how the investigator agent attributes causes, and gave model runtime probes enough headroom for cold starts.

- Relaxed freshness budgets for core API, auth, and system-info checks (now 30 minutes) and reclassified the published observability snapshot as informational, so a stale snapshot no longer flips the public website status off operational. Marketing's StatusView gained matching UI affordances and tests for the informational state, and the observability cron was shifted off the hour to :17 to avoid scheduler contention. (`5a0475f`)
- Investigation reports are now sanitized against the evidence packet: the investigator agent can no longer surface commits, file paths, or PRs that don't appear verbatim in source discovery, recent changes, hints, or evidence items, eliminating a class of hallucinated root causes. (`2049590`)
- Raised the agent runtime turn timeout from 45s to 120s and pushed model-matrix warning/outage latencies to 180s/360s, so cold model responses stop being reported as outages on the status page. (`2049590`)
- Source discovery for investigations now prioritizes product code over the observability framework itself, scores needles by specificity (endpoints, error codes, phrases), and drops low-confidence suspect commits from the shortlist — so suggested suspects point at the actual change that broke a check rather than the eval harness. (`7c8e040`, `7560151`)

## Highlights

- Status freshness thresholds tuned to stop spurious alerts
- Investigation reports can no longer cite commits or files outside the evidence
- Model runtime probe now tolerates cold-start latency up to 120s

