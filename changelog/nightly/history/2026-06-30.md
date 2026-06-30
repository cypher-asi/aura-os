# Second Opinion chat strategy and a live leaderboard

- Date: `2026-06-30`
- Channel: `nightly`
- Version: `0.1.0-nightly.717.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.717.1

Today's nightly introduces a new multi-agent "Second Opinion" chat strategy alongside the existing Council flow, and fixes a long-standing staleness issue in the Feed leaderboard so it stays current while you're looking at it.

## 2:42 AM — Feed leaderboard stays live while open

The Feed leaderboard now pulls fresh data every time it's opened and keeps itself current on a timed refresh, instead of showing cached entries until the app was restarted.

- Opening the leaderboard now fetches fresh entries and starts a periodic refresh that ticks every 60 seconds, with the interval torn down on close so nothing keeps polling in the background. (`4b9dcfd`, `552e072`)
- Locked in the new behavior with view-level and store-level coverage for refresh-on-open, the live poll cadence, and clean teardown on unmount. (`2063240`, `552e072`)

## 1:03 PM — Second Opinion (Mixture-of-Agents) chat strategy

A new multi-agent chat mode lands across the Rust server, protocol, and chat UI: an aggregator model produces the final answer while reference models advise it, served as a distinct strategy alongside Council.

- Adds a Mixture request contract to the chat API with an aggregator plus advisory reference models, routed through the same model/cache path as Council and rejected if a request tries to combine both strategies at once. (`38cc49b`)
- Extends the streaming orchestrator, session handling, and runtime to resolve mixture members, run the aggregator first on the Council runtime, and surface a dedicated Second Opinion presentation in the protocol bindings. (`38cc49b`)
- Wires Second Opinion into the chat UI with a new input-bar row, model controls, and Council panel updates, plus chat-stream hooks and store state so reference picks and the aggregator flow through end-to-end. (`38cc49b`)
- Caps the number of reference models and uses a fixed allocation capacity for Second Opinion to keep resource usage predictable. (`38cc49b`)

## Highlights

- New Second Opinion (Mixture-of-Agents) chat strategy
- Feed leaderboard now refreshes live instead of going stale

