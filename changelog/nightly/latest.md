# Dev-loop recovery and Council session routing fixes

- Date: `2026-07-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.771.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.771.1

A tight nightly focused on two backend correctness fixes: making dev-run recovery and task dependencies behave predictably, and stopping local-web Second Opinion chats from spawning competing session rows when Council members fan out.

## 2:43 AM — Dev-loop recovery, task dependencies, and Second Opinion session routing

Two backend fixes landed back-to-back: a broader repair of dev-run recovery plus task-dependency plumbing, followed by a targeted fix for local web Second Opinion session routing when Council members spawn.

- Dev-run recovery now prepares the task graph on resume and promotes a seeded loop-engineering task from Pending to Ready before the run starts, so recovered runs no longer stall on an unready task. (`818ba0b`)
- Introduced a dedicated task dependencies handler (~283 lines) with matching API tests, and generalized the automaton stop path to accept an arbitrary reason instead of hard-coding credit exhaustion in the log line. (`818ba0b`)
- Fixed local web Second Opinion routing so a fresh chat adopts its parent session before any nested Council-member frame can create a competing session row: the harness now captures `SessionReady` alongside pre-ready subagent frames and the orchestrator replays them in order to every subscriber. (`66347e4`)
- Added an SSE-level regression test asserting that the consumed `session_ready` reaches the browser ahead of `assistant_message_end`, locking in the correct event ordering for bare agent chat routes. (`66347e4`)

## Highlights

- Dev-run recovery now promotes pending loop tasks to Ready
- Task dependency handling gained a dedicated flow and API tests
- Local web Second Opinion chats now adopt the parent session correctly

