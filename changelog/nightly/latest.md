# Cleaner remote agent teardown and sharper acquisition analytics

- Date: `2026-06-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.698.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.698.1

Today's nightly tightens two very different seams. On the server, deleting a swarm-hosted agent now actually finishes the job end-to-end, with a graceful stop-then-delete handshake against the swarm gateway. On the web interface, analytics gets meaningfully more trustworthy: every visitor now carries a stable first-touch acquisition source, and the web surface stops inventing a brand-new app_version on every Render deploy.

## 1:02 AM — Reliable deletion of swarm-hosted agents

The agent delete handler now understands swarm-mode machines and drives the swarm gateway through a proper stop-then-delete handshake instead of leaving orphaned remote agents behind.

- Agent deletion now detects swarm-mode machines via HarnessMode and routes through the configured SWARM_BASE_URL, returning a clear service-unavailable error when the swarm gateway isn't configured rather than silently dropping the remote agent. (`90752cd`)
- When the gateway reports a 409 that requires stopping first, the server now issues a stop and retries the delete up to twelve times with a 5s backoff, surfacing a bad-gateway error only if the remote agent never finishes stopping. (`90752cd`)
- Backed by new integration coverage for remote delete behavior and refreshed status-probe tooling under infra/evals/status, raising confidence that observability probes exercise the new teardown path. (`90752cd`)

## 2:08 AM — Trustworthy acquisition source and stable web app_version

Two analytics fixes on the web interface: visitors are now tagged with a clean first-touch acquisition source that survives return visits, and the web platform reports one stable app_version instead of a new commit SHA per Render deploy.

- Each visitor's referrer and utm_source are classified into a tidy acquisition_source label (x, google, youtube, reddit, github, linkedin, facebook, hackernews, direct, or the raw domain) and stamped once via register_once so it rides on every client event and survives return visits. (`617b308`)
- At identify time the source is mirrored onto the user profile with people.set_once, so server-emitted events like session_active (True DAU) can also be broken down by where users actually came from. (`617b308`)
- getAppVersion() now collapses the continuously-deployed web surface to a single 0.0.0 label so Mixpanel's app_version and the X-App-Version header stop fragmenting on every Render deploy; Desktop and Mobile keep their real baked release versions, and the exact web build remains recoverable via getBuildInfo().commit. (`f50b081`)

## Highlights

- Remote swarm agents now delete cleanly via stop-then-delete
- First-touch acquisition source captured per visitor and mirrored to profiles
- Web app_version collapsed to a single label so Mixpanel stops fragmenting per deploy

