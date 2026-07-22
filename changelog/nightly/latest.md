# Chat session integrity and dev-loop recovery hardening

- Date: `2026-07-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.773.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.773.1

Today's nightly focuses on making chat sessions behave predictably end-to-end and keeping the dev loop resilient when tasks or upstream services misbehave. Session identity is now canonical from server to browser, initialization frames no longer race the SSE bridge, and directory outages are cleanly distinguished from dropped LLM streams.

## 2:43 AM — Dev-loop task readiness and Second Opinion session routing

Early-morning work fixed two related failure modes: dev runs stalling on pending tasks, and local web Second Opinion sessions losing their initial SessionReady frame.

- Dev-loop startup now prepares the task graph and promotes the loop engineering task from pending to ready before dispatching a run, so recovered runs actually progress instead of stalling on an unready task. (`818ba0b`)
- Added a provider circuit and generalized the automaton stop path so runs can be halted for reasons beyond credit exhaustion, with the reason surfaced in logs for easier diagnosis. (`818ba0b`)
- Fixed Second Opinion session routing on local web by capturing SessionReady as an initialization frame at cold-open and replaying it once every consumer is subscribed, so fresh chats adopt the parent session before any nested council-member frame can spawn a competing session row. (`66347e4`)

## 5:43 AM — Canonical chat session identity and directory-outage handling

Later in the day, session event delivery was made race-free and client-facing session identity was unified across SSE, persistence, URL binding, and reattachment, while aura-network outages were separated from real LLM stream drops.

- Reworked the chat streaming orchestrator so the harness-to-SSE relay only starts after every downstream consumer (SSE bridge, persistence, watchdog, live-stream registry, subagent capture) is attached, eliminating attach-time races and silent lag on SessionReady and early council frames. (`af98071`)
- Canonicalized client-facing session identity across SSE, persistence, URL binding, history, and reattachment, with new resolution tests covering the fresh-chat routing paths. (`8e9c8b2`)
- Introduced a dedicated agent_directory_unavailable 503 response so transient aura-network outages surface as a retryable directory error instead of being mislabeled as a dropped LLM stream in the browser's auto-retry path. (`8e9c8b2`)
- Local shadow agents are now only accepted as a fallback when their persisted owner matches the authenticated session, letting desktop survive a directory outage without opening a cross-user authorization bypass. (`8e9c8b2`)

## Highlights

- Fresh chats reliably deliver SessionReady before any turn events
- Dev loop auto-promotes pending tasks and recovers from provider stalls
- Directory outages no longer masquerade as dropped model responses
- Local shadow agents are gated by authenticated ownership

