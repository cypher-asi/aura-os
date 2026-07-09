# Hosted dev-loop auth and quieter task completion toasts

- Date: `2026-07-09`
- Channel: `nightly`
- Version: `0.1.0-nightly.747.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.747.1

Today's nightly threads together two focused fixes: the swarm dev-loop can now authenticate against the hosted harness end-to-end, and the desktop interface stops double-firing task completion notifications when a run wraps up.

## 11:28 PM — Swarm dev-loop authenticates against the hosted harness

Dev-loop pause, stop, resume, and status calls now carry the caller's JWT through a dedicated harness transport, unblocking swarm runs against the hosted harness.

- Pause, stop, resume, and status endpoints for the dev loop now extract the caller's JWT and thread it into control_loop and detached-run lookups, so hosted harness requests are properly authenticated instead of being made anonymously. (`103f263`)
- Introduced a dedicated harness_transport module and persisted a per-run harness_auth_token alongside the harness base URL, letting each running loop reconnect to its hosted harness with the right credentials. (`103f263`)

## 1:19 AM — Task completion notifications no longer fire twice

The desktop interface now briefly delays task completion toasts and suppresses them when the terminal task-run loop event arrives, eliminating duplicate notifications at the end of a run.

- Task completion events are held for a short dedupe window (~2.5s) and only surfaced as a toast and OS notification if no terminal task_run LoopEnded event arrives to represent the same completion. (`bbddfd9`)
- Added a full test suite around useTaskNotifications covering the delayed-delivery, terminal-loop suppression, and IPC posting paths to lock in the new dedupe behavior. (`bbddfd9`)

## Highlights

- Hosted harness auth token now flows through dev-loop control
- Task completion toasts and OS notifications are deduplicated against terminal loop events

