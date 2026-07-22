# Session routing gets authoritative, dev-loop recovery gets smarter

- Date: `2026-07-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.772.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.772.1

Today's nightly focuses on the plumbing that keeps chat sessions and dev-loop runs coherent end-to-end. The team made SessionReady the single source of truth for fresh chat routing, closed off attach-time races in streamed events, and tightened dev-loop recovery so tasks reach the runner in the right state.

## 2:43 AM — Dev-loop recovery and Second Opinion session routing

Fixes to how dev-loop runs bootstrap tasks and how local Second Opinion chats adopt their parent session.

- Dev-loop starts now prepare the task graph up front and promote a seeded loop-engineering task from pending to ready before the runner attaches, so recovered runs no longer stall on an unready task. (`818ba0b`)
- Added a dedicated task dependencies handler plus API coverage, and threaded the automaton id through loop retry state so credit-exhaustion and generic stop paths log with proper context. (`818ba0b`)
- Fresh local web Second Opinion chats now capture and replay SessionReady first so the parent session is adopted before any nested council-member frame can spawn a competing session row. (`66347e4`)

## 5:43 AM — Authoritative SessionReady and race-free event delivery

A broad hardening pass makes SessionReady authoritative for fresh chat routing and closes attach-time races across harness, server, live replay, and automaton event delivery.

- The chat orchestrator now defers starting the turn-stream relay until every downstream consumer — SSE bridge, persistence, watchdog, subagent capture, and the resumable live-stream registry — is attached, so initialization frames and immediate post-SessionReady output can no longer outrun any receiver. (`af98071`)
- Harness, WS bridge, and live-stream layers were reworked to guard against silent broadcast lag and attach-time races, with the session module and runner collector gaining explicit handling for pending events and reader handles. (`af98071`)
- ChatAppRoute and standalone agent chat hooks on the interface side were simplified as the server now guarantees SessionReady ordering, removing client-side compensations that are no longer needed. (`af98071`)

## Highlights

- Second Opinion chats now route to the correct session on local web
- Streamed harness events survive attach-time races
- Dev-loop seeds tasks in a runnable state before starting

