# Parallel chat sessions land alongside a sturdier dev-loop

- Date: `2026-05-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.543.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.543.1

A heavy day across desktop and server: agents can now run truly concurrent chat sessions on the same instance, the automation dev-loop got a new resilience crate with retries and orphan recovery, and a long tail of UI polish fixes — from the Play button spinner to per-task indicators and cold-open chat paint — landed together.

## 11:47 AM — Parallel chat sessions per agent instance

Chats on the same agent instance can now stream concurrently, with server-side partitioning by session id and matching per-session client lanes.

- Server now keys chat sessions by storage session_id, so two POSTs to the same agent instance with different sessions open distinct ChatSession entries, take separate turn-slot mutexes, and stream end-to-end concurrently; harness_agent_id gained an optional session segment and reset endpoints sweep every per-session entry under an instance. (`d9fffcf`, `07d2f5b`, `42b7205`, `b4e937e`)
- Frontend stream lanes are now keyed by session id across both project chat and standalone agent chat, with a migration orchestrator that carries state through the fresh-canvas→real flip and mid-stream auto-fork, plus a per-session streaming dot in the sessions sidebar. (`91e4da2`, `d0dadf8`, `6d655fe`, `4316abb`)
- A PartitionRegistry abstraction replaces the four ad-hoc per-partition maps so every per-key surface (stream entries, send-control, agent replay, chat UI) migrates and prunes in lockstep — closing the structural footgun that caused earlier asymmetries. (`5eab453`, `d743011`)
- Server-side chat session ids are now typed as SessionId end-to-end and chat helpers were converted to borrowed config structs, removing the clippy too_many_arguments suppressions accumulated during the partitioning work. (`40eb7f3`, `8e7df05`, `7b93d09`)

## 11:47 AM — Loop Stop surfaces harness failures

Stop now reports when the harness side actually fails to halt instead of silently lying to the UI.

- Failed harness POST /automaton/:id/stop calls are now logged at error and forwarded as a harness_error field on the loop_stopped event, so the UI can see when the local registry cleared but the harness automaton is still running. (`8069198`)

## 12:05 PM — Loop indicator and per-task spinner finally line up

A coordinated frontend and backend pass made the running-task and Play indicators reliably reflect live automation state.

- Play button and Run tab now share a single SVG PlayLoopGlyph that draws the play polygon and rotating progress ring in one coordinate system, themed by the accent color so the ring stops drifting and stops clashing with non-blue themes. (`d395fec`, `fbf0f00`, `7c52b2b`)
- Per-task spinner now lights up during active dev-loop runs: the LoopHandle throttle no longer swallows the first set_current_task, and the frontend unions live-task ids with the loop-activity store before deciding whether to upgrade a row to in_progress. (`3baa3be`, `cb61e96`, `ce3648d`)
- Dev-loop now auto-retries harness research-loop and completion-contract aborts via a relaxed task-budget gate, and stamps session_id onto task output so completion no longer drops task_output / task_steps events with a missing-session warning. (`1943ec5`, `504fd19`)
- Sidekick Run/Tasks panes and chat got several layout fixes: tool markers with nested parens now hoist into Block cards, the cooking indicator sits above the ModeSelector row, and the last-picked model is now persisted per generation mode across desktop restarts. (`1c61ae3`, `d0f6e45`, `ec8af66`)

## 4:08 PM — Sidekick Log fills in between engine milestones

Dev-loop runs now emit log lines at tool, turn, and forwarder lifecycle so the Log panel stops looking idle.

- The forwarder, tool-call lifecycle, and assistant message boundaries now emit log_line events (token totals included where available), with a new log_throttle module rate-limiting high-frequency channels like text_delta so a fast turn cannot flood the panel. (`085aa8f`)

## 4:19 PM — Chat app cold open paints instantly

Opening the Chat app no longer waits on the setup round-trip before showing the familiar surface.

- useChatAppAgent now seeds from the warm agent store and a persisted last-agent id and runs setup as a background heal, ChatPanel chrome mounts on the first frame, and hover prefetch re-keys to the agent-scoped endpoint so a click lands on already-warm data. (`9476247`)
- Cold open also stops blocking on heavyweight work: snapshot equality switched from full JSON.stringify to a tail-event check, off-screen bubbles use content-visibility: auto, and syntax highlighting runs against a deferred value so high-priority renders commit first. (`9476247`)

## 4:39 PM — Build-as-truth gate and cancel-mid-tool-call healing

Two server-side reliability fixes: an opt-in cargo-check gate for dev-loop task completion, and a multi-layer fix for the Anthropic 400 caused by stopping a tool call mid-stream.

- AURA_BUILD_GATE now demotes task_completed to task_failed when cargo check fails against the resolved workspace, and the exploration budget gained a cache-aware classifier so re-reads of the same file no longer burn through the soft/hard ceilings. (`fd95845`)
- Stopping during a streaming tool call no longer poisons the next turn: write-time seeding, a cancel-finalize sweep that synthesizes tool_results for orphaned tool_use blocks, read-time sanitization across all tool names, and an API-edge coercion together prevent the Anthropic 400 on replay without requiring a storage migration. (`56e386d`)

## Highlights

- Parallel chat sessions per agent instance, end-to-end
- New aura-os-automation crate with retries, orphan recovery, and build-gate
- Per-task spinner and Play loop indicator finally read correctly
- Cancel-mid-tool-call no longer poisons future turns with 400s
- Chat-app cold open paints instantly instead of waiting on setup

