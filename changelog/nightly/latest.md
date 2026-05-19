# Parallel chat sessions, a resilient automation loop, and a clearer Run affordance

- Date: `2026-05-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.542.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.542.1

Today's nightly lands the long-running parallel-session-chats work end-to-end, hardens the dev-loop with shared retry budgets and orphan recovery, and sharpens the sidekick's automation UI — including a redesigned play-with-progress-ring indicator and a per-task spinner that finally stays in sync with what the harness is actually doing.

## 11:47 AM — Parallel chat sessions on the same agent instance

Per-session partitioning lands across server harness keys and client stream lanes so two sessions of the same agent can stream simultaneously without sharing state.

- Chat sessions are now partitioned by storage session id end-to-end: the harness session key carries an optional third segment, the server opens distinct ChatSession entries and turn slots per session, and reset sweeps target the full per-session prefix so old sessions and mutexes no longer leak. (`d9fffcf`, `07d2f5b`, `42b7205`)
- The interface keys every chat stream lane by session id for both project and standalone agent chat, with a migration helper that carries state across the fresh-canvas→real and auto-fork session flips, plus a per-session streaming indicator in the SessionsList sidebar. (`91e4da2`, `d0dadf8`, `6d655fe`)
- Followup cleanup consolidates per-partition state into a single PartitionRegistry, unifies auto-retry state across chat surfaces, and tightens the server's session_id chain to a typed SessionId from ingress to persistence — closing the parse-back hole the new partitioning had exposed. (`4316abb`, `5eab453`, `40eb7f3`, `7b93d09`, `8e7df05`)
- New projects now appear at the top of the left menu instead of the bottom, and the model picker menu renders through a body portal so adjacent panels can no longer clip it. (`e260104`, `f50f007`)
- A Windows CI fix passes shell:true through the parity helpers so npm.cmd no longer aborts every Windows lane with EINVAL, unblocking community PRs against the required Desktop check. (`c84e220`)

## 11:47 AM — Dev-loop resilience, Stop semantics, and the new aura-os-automation crate

A coordinated push hardens the automation loop with shared retry budgets and orphan recovery, fixes a wedged-after-Stop chat, and absorbs corrupt tool history so Anthropic 400s stop poisoning sessions.

- A new aura-os-automation crate now owns transient/restart/push classifiers, retry budgets, task-failure synthesis, tool- and task-level retry trackers, and an InProgress orphan sweep at loop start; the dev-loop wires these in so silent task failures get a reason, retries respect a shared budget, mid-run crashes resume cleanly, and the stalled spinner from stale event-kind matching is gone. (`3a435c3`, `19dfe8b`, `963aace`, `481f5c6`)
- Pressing Stop (or refreshing) now POSTs a new cancel-turn endpoint and a server-side drop guard forwards Cancel to the harness and releases the per-partition turn slot — fixing the case where the next message hung for 90s on a wedged warm session after plan-mode → code-mode. (`239ae9f`, `c2c61c3`)
- Chat history is now defended against malformed tool blocks: tool_use.input is coerced to an object before persist, duplicate tool_result blocks are deduped at replay with the wire-level tool_use_id, and the harness distinguishes Timeout/StreamClosed from a clean Done so early disconnects surface as real failures. (`6231280`, `25bab2d`, `f57e51e`)
- Dev-loop harness events now persist through the same SessionEvent pipeline as chat, so replays inherit dangling-tool-use stripping, recent-window caps, blob truncation, and the new parallel-result dedupe. (`aec45f6`)
- Several chat UX papercuts are fixed: '+ New chat' now actually starts a new session and gets a Haiku-style title, Plan mode no longer yanks the sidekick off the Sessions tab, untouched agents restore the last-picked model, deleting a stale pending Spec stops showing 'Bad Request', and the project's Add Agent flow dismisses cleanly without creating duplicates. (`8d28e5e`, `477d5a3`, `ac9acbc`, `d7f7e79`, `ab57bd4`, `19c2fb0`)
- Plan mode regains the planner toolkit — create/update/delete/transition_task are now surfaced so the planner can organize work without starting it — while execution tools (run_task, task_done, submit_plan) stay structurally off. (`cc70320`)
- The pinned 'cooking' indicator gets a proper backdrop and ListBlock's header is aligned with SpecBlock so the hover copy affordance no longer overlaps the item count. (`a6ea717`, `651e3af`, `8beb1f5`)
- Several oversized server and harness modules are split along responsibility boundaries (agent/chat, dev_loop adapter/streaming/signals, harness automaton_client) to land under the 500-line cap without changing public paths or runtime behavior. (`be34513`, `5d6766d`, `bcbb274`)

## 11:47 AM — Streaming tool-call snapshots stop being treated as corruption

The persistence layer now recognizes Anthropic's input_json_delta accumulator as a streaming protocol rather than logging every partial chunk as upstream corruption.

- Mid-stream string tool_use.input values are parsed when complete and skipped at trace level when partial, eliminating the per-chunk ERROR spam and the throwaway _normalized placeholders that previously littered the session event stream. The final object snapshot still lands and persists normally. (`321857f`)

## 11:47 AM — Automation model picker, split-screen sidekick, and per-task spinner binding

The sidekick gains a deliberate model selector and a 50/50 split toggle, while a backend fix finally binds the per-task spinner to the live task during automation runs.

- An AutomationBar model picker — also surfaced in the Run pane header — lets each project pick a deliberate chat model for loop runs, persisted per project and locked once the loop is starting/active/paused so no one can pretend to swap mid-run. (`d6f026a`, `dbd5a73`)
- A new titlebar Columns2 button toggles a 50/50 split between the main panel and the sidekick lane, persisted across reloads, with ResizeObserver-driven rebalancing, auto-expand when the sidekick is collapsed, and a deterministic restore to the standard 320px width when toggled off. (`115b4e7`, `f1b11d9`, `a698023`)
- The dev-loop forwarder now publishes the typed current_task_id onto LoopActivity so per-task spinners in TaskList can bind, fixing the case where the run looked idle even while the harness was actively working. (`57e7daa`)
- The Play button on the AutomationBar and the Run tab in SidekickTaskbar keep the play glyph visible at all times and overlay a rotating progress ring while the loop is active, so users can still find the control during a live run. (`01c9f8a`, `7163610`)
- The dev-loop's automation crate now also re-readies cross-run Failed tasks at loop start (gated by the shared task-level retry budget), and dev-loop agents are spliced with the InvokeProcess capability so cargo check/test no longer burn turns on permission errors. (`9a5f5b5`, `f99e94a`)
- The pinned cooking indicator is realigned with the chat content edge and the same gradient backdrop is applied to the sidekick Run pane and Tasks-tab Live Output so trailing rows stop bleeding through the shimmer. (`569e866`)

## 11:47 AM — Stop failures no longer lie about loop state

When the harness rejects or drops a stop request, the dev-loop now logs it at error and forwards the failure in the loop_stopped payload instead of optimistically reporting idle.

- POST /automaton/:id/stop failures are emitted as harness_error on the loop_stopped event with the harness base URL, so the UI can surface 'UI says stopped but harness is still going' instead of hiding it in a warn log — while preserving the contract that the local registry still clears when the harness is genuinely unreachable. (`8069198`)

## 12:05 PM — Unified Play/loop indicator and a per-task spinner that finally tracks reality

An afternoon polish pass replaces the drifting overlay icons with a single shared glyph, then fixes the remaining races that left the actively-running task rendered as a hollow circle.

- A new shared PlayLoopGlyph component draws the play polygon and the optional spinning progress ring inside one SVG centred on the triangle's centroid, replacing the previous fragile absolute-overlay approach across both AutomationBar and SidekickTaskbar; the ring now also takes its colour from the active theme accent instead of a fixed blue. (`d395fec`, `fbf0f00`)
- A backend throttle bypass ensures the very first set_current_task always broadcasts, a shared getTaskDisplayStatus helper now upgrades ready→in_progress when the server reports the task as live, and the live-task signal is unified onto the loop-activity store so TaskList, TaskFeed, ProjectWorkView, and mobile views all stay in lockstep. (`3baa3be`, `cb61e96`, `ce3648d`)
- Tool markers with nested parentheses like search_code(pub fn (ack|len), context=1) now hoist into Block cards across LLMOutput, derive-activity, and FormattedRawOutput instead of leaking through as raw text. (`1c61ae3`)
- The dev-loop classifier now recognises harness research-loop aborts and 'task completed without any file operations' shape failures, and the task-level retry gate falls through to its own budget when there's no tool-call history — letting these task-shape failures retry up to three times instead of getting stuck on the first crash. (`1943ec5`)
- The pinned cooking indicator is lifted above the input bar's ModeSelector row on both desktop and mobile so the Code/Plan/Image/3D pills are no longer covered by its backdrop. (`d0f6e45`)

## Highlights

- Two sessions on the same agent now stream concurrently end-to-end
- Dev-loop retries, recovers orphans, and re-readies failed tasks across runs
- Stop reliably cancels the harness and releases the turn slot
- New split-screen sidekick toggle and a per-project automation model picker
- Play button keeps a concentric progress ring while the loop runs

