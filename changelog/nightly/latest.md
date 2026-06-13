# Smoother streaming chat, virtualized transcripts, and a rebuilt input bar

- Date: `2026-06-12`
- Channel: `nightly`
- Version: `0.1.0-nightly.660.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.660.1

A heavy day for chat performance and polish: the input bar was rebuilt from the ground up to kill typing lag, transcripts now virtualize and paginate, streaming reveals stay in order, and tool markup that used to leak into prose is finally rendered as proper blocks. Behind the scenes, dev-loop runs survive server restarts, swarm VMs expose live logs, and the observability pipeline was reworked to publish a single, trustworthy status snapshot.

## 11:13 PM — Chat streaming, terminal links, and project chrome polish

A long late-night pass tightened the chat transcript, fixed terminal link handling on Desktop, and brought streaming and terminal I/O onto a shared frame budget.

- Frame-batched the chat reveal loop and terminal PTY writes so token streaming and xterm output stop starving each other on the renderer thread, with memoized per-paragraph markdown, coalesced context-ring updates, and binary WS frames replacing JSON+base64 for terminal output. (`449a6ad`)
- Fixed a Desktop regression where clicking a terminal link opened an "about:blank" picker on Windows; URIs are now passed directly to window.open and the wry shell only forwards http/https/mailto through the OS browser. (`3b22dea`)
- Streaming timelines now reveal strictly in order — tool blocks, thinking cards, and later paragraphs hold back until the prose above finishes its typewriter, with matching collapse/expand animation and a scroll-into-view when users expand a block. (`314d95e`, `62300dc`, `ffb6201`)
- Sidebar projects gained open/closed folder icons across both the zui Explorer and the desktop LeftMenuTree, with color and spacing tuned to match labels, and rename rows now underline in edit mode. (`f925d5a`, `1b62a3e`, `058af79`, `8288e7b`)
- Cleaned up several chat-surface rough edges: long project names ellipsize in the input chip, command rows no longer render a bare "$ ..." placeholder, user messages preserve their line breaks and spacing, copy buttons reveal only on hover, and the streaming indicator drops its gradient band for a tighter pill. (`39201e8`, `94d469c`, `234717a`, `03686c5`, `f9f6cfd`, `44404f9`, `80ca317`, `1d980da`)
- Dev-loop MCP start_dev_loop now accepts a model argument and threads it through to /loop/start, unblocking agent-driven loop starts that previously hit the harness "missing model" 400. (`7c4f02f`)
- Hardened the observability and CI pipeline by running complete health checks across releases and retrying transient artifact-polling fetch failures. (`71be72f`, `5f1e3a7`)

## 12:58 AM — Dev-loop picks up the calling agent's model automatically

A follow-up so the agent-driven dev-loop path always has a model to send to the harness.

- When start_dev_loop is invoked without an explicit model or AURA_MCP_MODEL, the MCP tool now looks up the calling agent instance and forwards its default model to /loop/start, eliminating the remaining "missing model" 400s on live agent-driven runs. (`5d12a6c`)

## 1:16 AM — Default desktop service URLs in release workflows

A small but meaningful release-config cleanup.

- Release Infrastructure: nightly, stable, performance-benchmark, and desktop-validate workflows now default the desktop service URLs consistently, removing duplicated per-workflow configuration. (`f82c98f`)

## 1:20 AM — Inline thinking, swarm VM logs, and resilient dev-loop streaming

Three substantive product changes landed together: reasoning is now visible inline, swarm agents expose their VM logs, and dev-loop runs keep the task UI updating under load.

- Thinking segments now render as full inline prose under a small caption row in the activity timeline instead of hiding behind a "Thought for Xs" chevron, flowing chronologically between tool rows on live, just-finalized, and historical turns. (`9d4c5fe`)
- Added a VM Logs tab to agent details that proxies the swarm gateway's per-VM live tail and termination snapshots through the server. (`a4d4200`)
- Fixed task UI freezes during dev-loop runs: the server now coalesces consecutive text_delta events per task before broadcasting, the client refetches tasks on ws_resync_required, and the post-start_dev_loop bridge retries once instead of silently leaving a loop without a forwarder. (`341bdff`)

## 3:14 AM — aura-swarm integration guide and operations runbook

Documentation catches up to the swarm surface area.

- Published an aura-swarm integration guide, environment-variable reference, and an operations runbook, plus updated README and .env.example entries. (`71ae735`)

## 5:56 AM — Rebuilt input bar, virtualized transcripts, and trustworthy observability

The day's biggest push: zero-reflow typing, paginated session history, leaked tool markup rendered as blocks, dev-loop reattachment across restarts, per-tool permissions, and a consolidated observability pipeline.

- Rebuilt the chat input bar end to end: a new auto-resize using field-sizing and mirror-based wrap detection eliminates per-keystroke forced reflow, draft updates are localized to a leaf DraftedInputBar, and the 1500-line component was decomposed into memoized slot components (ModelControls, ChatModeBar, ProjectPicker, AgentInfoBar, AttachControl, InputStatusHints, AttachmentPreviews) plus extracted useInputTriggers and useModelSelection hooks — a draft-only change now re-renders nothing but the textarea path. (`adf4d1f`, `f88a075`, `c6b4a08`, `b6183e2`, `8e95031`, `f6b8795`, `bdd7cbd`)
- Virtualized the chat transcript with @tanstack/react-virtual and added cursor-paginated session-history endpoints, so huge sessions load only a trailing window, older pages prepend on demand, session switches paint from cache, and per-token renders are isolated to a StreamingTail row. (`d43cfb4`)
- Tool markup that leaked into text — Anthropic <invoke> XML, hybrid [tool_use ...] openers, compaction-dialect markers, and unterminated [tool_result ...] dumps — now hoists into proper tool cards, with a server-side scrubber stripping residue before persistence so cold-start history rebuilds stay clean. (`9c4faf9`, `0fa0ab4`, `042d15e`)
- Dev-loop runs now survive aura-os-server restarts: a per-run handle file lets the AutomationBar detect a detached harness loop and re-adopt it via the existing /loop/start conflict path, rebuilding the event forwarder and re-emitting loop_opened so tasks keep advancing in the UI. (`9b916d7`)
- Generation modes consolidated onto the harness session — image mode joins video and 3D, with quality threaded end to end — and agents gained tri-state per-tool permissions (on/ask/off) editable from the Permissions tab and respected by chat, dev-loop, and single-task automaton runs. (`f1afd33`)
- Replaced zui Explorer/Item across Tasks, Plans, Files, ProjectList, Feed, Profile, Marketplace, Feedback, and the sidekick surfaces with shared ListItem/ListTree components, removing hashed-class CSS overrides that papered over zui row metrics. (`7ef7956`)
- Terminals now remember a per-project command history across sessions and tabs, with Arrow Up/Down navigating the shared store instead of the per-PTY shell history. (`23221c7`)
- Stopped the just-sent chat bubble from jumping after send by aliasing the optimistic temp row's identity to its persisted id, skipping ResizeObserver measurements during the centered empty-thread state, and re-pinning the transcript when input clearance changes mid-frame. (`2025928`)
- Quieted a chromiumoxide WARN firehose that was dumping multi-KB CDP payloads on every diverged event, drowning dev-loop logs; divergent methods now log once with a truncated preview and the full payload moves to trace. (`d9dfdb3`)
- Reworked the observability pipeline so a single generated status.json drives the public /observability page, with scoped probe permissions, regression-focused evals, persisted status history, and tightened eval cadence — replacing the previously duplicated bundled snapshot. (`45c287f`, `1d96402`, `573e753`, `086a496`, `115a761`, `240d4b2`, `1bb31b2`, `7719167`, `56be76b`, `26fcc3a`)
- Fixed server-side fallout uncovered by the pagination work: stale empty sessions now retire correctly after the migration-0014 filter, and Vitest suites were stabilized against Node 25's experimental Web Storage stub. (`2ecee30`, `58e3328`)

## Highlights

- Frame-batched streaming and a rebuilt input bar eliminate typing and reveal lag
- Chat transcripts now virtualize and cursor-paginate session history
- Tool markup leaks render as proper blocks instead of garbled text
- Dev loops reattach across server restarts and keep the task UI live
- Per-tool permissions and a fuller generation catalog ship end to end

