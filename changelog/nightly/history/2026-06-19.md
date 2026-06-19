# Reliable swarm agent deletion and first-touch acquisition analytics

- Date: `2026-06-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.697.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.697.1

Today's nightly tightens up two very different surfaces: the server now properly tears down remote swarm agents instead of leaving stale probes behind, and the web interface starts capturing where new users actually come from so growth and retention can be analyzed by source rather than guessed at.

## 1:02 AM — Swarm agent deletion now drains remote machines cleanly

Deleting an agent backed by the swarm gateway now coordinates a stop-and-retry flow with the remote machine instead of leaving orphaned status probe agents behind.

- Agent deletion now detects swarm-backed agents via machine type and routes them through the swarm gateway, returning a clear service-unavailable error when SWARM_BASE_URL isn't configured rather than silently leaving the remote agent running. (`90752cd`)
- The swarm delete path now handles the gateway's 409 "needs stop" response by issuing a stop and retrying the delete up to a dozen times on a 5-second cadence, surfacing a bad-gateway error only if the remote agent never finishes stopping. (`90752cd`)
- New server- and probe-side tests cover the remote-delete behavior end to end, so the cleanup path for status probe agents is exercised on every build. (`90752cd`)

## 2:08 AM — First-touch acquisition source captured in web analytics

The interface now classifies each visitor's first referrer and utm_source into a tidy acquisition_source label and pins it for the lifetime of the user, so signups and engaged users can be broken down by where they actually came from.

- A new classifier collapses referrers and utm_source into clean labels — x (covering t.co, twitter.com, x.com), google, youtube, reddit, github, linkedin, facebook, hackernews — falling back to the real domain for unlisted sources and "direct" when there's no referrer at all. An explicit utm_source always wins over the referrer. (`617b308`)
- The label is stamped once via register_once at init so it survives return visits and rides on every client event, and mirrored onto the user profile with people.set_once at identify time so server-emitted events like session_active (True DAU) can also be sliced by source. (`617b308`)
- Classifier and pipeline tests lock in the mapping rules and the register_once / set_once behavior, including the no-op path when no source was ever captured. (`617b308`)

## Highlights

- Remote swarm agents are now fully deleted, with a stop-then-retry handshake
- First-touch acquisition source (x, google, direct, …) now rides on every analytics event
- Acquisition source mirrored onto user profiles for server-emitted DAU breakdowns

