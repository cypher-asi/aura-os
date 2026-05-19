# Parallel chat sessions, dev-loop resilience, and a redesigned run indicator

- Date: `2026-05-19`
- Channel: `nightly`
- Version: `0.1.0-nightly.541.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.541.1

A heavy day across the stack: each storage session now gets its own end-to-end chat lane on both server and client, the dev-loop gained real retry budgets and orphan recovery via a new automation crate, and the automation Play button was rebuilt as a single concentric glyph so a running loop is unmistakable. Windows CI also stopped silently failing community PRs.

## 11:47 AM — Per-session chat lanes across server and interface

Chat partitions are now keyed by storage session id end-to-end, so two sessions on the same agent instance can stream concurrently without sharing state.

- Server-side chat sessions are now partitioned by a three-segment {template}::{instance}::{session_id} key, giving each storage session its own ChatSession entry, turn slot, and concurrent stream; reset sweeps were repaired to match the new shape and a typed SessionId is threaded through the persistence chain instead of a stringly-typed id. (`d9fffcf`, `07d2f5b`, `42b7205`, `40eb7f3`, `8e7df05`)
- Project chat and standalone agent chat now key their stream lanes, send-control, and chat-UI state by session id, with a single migrateChatPartition orchestrator handling the fresh-canvas→real and auto-fork mid-stream flips; the sessions sidebar shows a per-session streaming indicator for turns in flight in other sessions. (`91e4da2`, `d0dadf8`, `6d655fe`, `4316abb`, `5eab453`)
- Documented that parallel sessions share the project's working directory, terminal, and destructive tools, and replaced the chat handlers' too_many_arguments suppressions with config structs so the new session-keying parameters stay in lockstep. (`b4e937e`, `7b93d09`)
- Newly created projects now appear at the top of the left menu via an atomic prependProject store action instead of being appended by the persisted-order normalizer. (`e260104`)
- The model picker dropdown is now portalled to document.body with fixed positioning, so it can no longer be clipped by the chat lane's overflow rules or look like the sidebar is slicing it. (`f50f007`)
- Windows CI no longer fails community PRs at the first npm ci: the parity helpers now pass shell:true for npm/npx shims so Node's CVE-2024-27980 hardening stops blocking spawnSync with EINVAL. (`c84e220`)

## 11:47 AM — Dev-loop resilience, Stop-button fixes, and the new aura-os-automation crate

A broad reliability pass: retries and orphan recovery move into a new automation crate, Stop actually cancels the harness, and a cluster of chat-history corruption bugs that wedged sessions are fixed.

- Pressing Stop or refreshing a chat now forwards Cancel to the harness via new cancel-turn endpoints and an SSE drop guard, releasing the per-partition turn slot instead of leaving it held until the 90s idle timeout — fixing the silent wedge after long plan-mode turns. (`239ae9f`, `c2c61c3`)
- Introduced the aura-os-automation crate to own classifiers, retry budgets, exploration budgets, and a task-context resolver, and migrated the dev-loop's progress mapping to canonical event-kind constants — unsticking the activity spinner that was matching against stale event names. (`3a435c3`, `19dfe8b`, `481f5c6`)
- Dev-loop now synthesizes a failure reason when the harness omits one, gates tool retries at 8 and task retries at 3 via shared budgets, and sweeps orphaned InProgress tasks back to Ready at loop start; harness events are also persisted as SessionEvents so replays share chat's compaction pipeline. (`963aace`, `aec45f6`, `f57e51e`)
- Hardened chat persistence against Anthropic 400s: non-object tool_use.input is coerced to a structured marker before persist, duplicate tool_result blocks sharing a tool_use_id are deduped at replay, and tool_use_id is now threaded through tool_result persistence. (`6231280`, `25bab2d`)
- Fresh chats now correctly start a new session and get a generated title (the new-chat pin is armed on the fresh-canvas partition), Plan mode keeps you on Sessions when you picked it, the sidekick stops yanking off Sessions to Tasks on send, fresh agents restore the last-picked model, and Delete Spec stops surfacing a bare 'Bad Request' on stale optimistic rows. (`8d28e5e`, `477d5a3`, `19c2fb0`, `ac9acbc`, `d7f7e79`)
- Plan mode now exposes create/update/delete/transition_task so the planner can structure work without starting it, and the + Add Agent flow closes the picker synchronously and lands users directly in the new agent's chat with the input focused. (`cc70320`, `ab57bd4`)
- List blocks now match SpecBlock with a copy button so the hover affordance no longer overlaps the item count, and the pinned cooking indicator gets a full-width backdrop so streaming text fades under it instead of bleeding through. (`a6ea717`, `651e3af`, `8beb1f5`)
- Behaviour-preserving split of oversized server and harness modules — chat persist/streaming, dev-loop signals/adapter/side-effects, and automaton_client — to bring files under the 500-line cap without changing public paths. (`be34513`, `5d6766d`, `bcbb274`)

## 11:47 AM — Tool-call streaming snapshots no longer pollute persisted history

Mid-stream tool_use input chunks are now recognized as the streaming protocol instead of being flagged as upstream corruption.

- Partial Value::String tool_use.input snapshots (Anthropic's input_json_delta accumulator) are now treated as streaming chunks: complete objects are parsed through, incomplete strings get a {} placeholder at trace level, and intermediate snapshots are no longer written as _normalized markers — ending the ERROR-per-chunk log spam and throwaway SessionEvent writes. (`321857f`)

## 11:47 AM — Automation model picker, split-screen sidekick, and live-run affordances

The Run pane and AutomationBar get a deliberate model picker, a new split-screen toggle balances the sidekick lane, and the Play button stays visible with a spinning ring while a loop runs.

- Automation runs now use a deliberate per-project model selection persisted in automation-loop-store, surfaced in both the AutomationBar and the Run pane header and locked while a loop is starting/active/paused so users can't pretend to swap mid-run. (`d6f026a`, `dbd5a73`)
- A new Columns2 titlebar button toggles a 50/50 split between the main panel and the sidekick lane, persisted across reloads and balanced via ResizeObserver, with toggle-off restoring the standard 320px sidekick width. (`115b4e7`, `f1b11d9`, `a698023`)
- The AutomationBar's Play button and the Sidekick Run tab now keep their Play glyph visible during active runs and overlay a spinning progress ring on top, so a running loop is no longer mistaken for an idle one. (`01c9f8a`, `7163610`)
- The dev-loop now publishes current_task_id onto LoopActivity so the per-task spinner in TaskList can bind to live work, and InvokeProcess capability is spliced in-memory into dev-loop agents so cargo check/test stop hitting permissions errors on non-admin agents. (`57e7daa`, `f99e94a`)
- Cross-run Failed tasks are now re-readied at loop start under the shared TASK_LEVEL_RETRY_BUDGET, so a prior Anthropic-400 crash no longer leaves work permanently stuck waiting for a Ready scheduler pick. (`9a5f5b5`)
- The pinned cooking indicator now aligns with the chat content edge and the same gradient backdrop was added to the sidekick Run and Tasks Live Output panes so trailing task output stops bleeding through the shimmer. (`569e866`)

## 11:47 AM — Harness Stop failures are now surfaced instead of silently swallowed

When the harness rejects or ignores a stop request, the divergence is now visible to the UI.

- Failed POSTs to the harness's /automaton/:id/stop are now logged at error and forwarded in the loop_stopped event payload as harness_error, making 'UI says stopped but harness is still running' visible while preserving the contract that the local registry still clears even when the harness is unreachable. (`8069198`)

## 12:05 PM — Unified PlayLoopGlyph, task-spinner unification, and research-loop auto-retry

The Play-with-ring affordance is rebuilt as a single concentric SVG, the per-task spinner is consolidated onto one store, and the dev-loop now auto-retries research-loop aborts.

- The Play icon and its rotating progress ring are now drawn as a single shared PlayLoopGlyph SVG, with the ring centred on the play polygon's centroid and themed via --color-accent so it stays concentric, themed, and unmistakable on both the AutomationBar and the Sidekick Run tab. (`d395fec`, `fbf0f00`)
- The per-task spinner regression is fixed at three layers: a backend throttle bypass so set_current_task always broadcasts, a shared getTaskDisplayStatus helper that can upgrade ready→in_progress, and a unification of live-task tracking onto useLoopActivityStore so the two parallel stores can no longer diverge. (`3baa3be`, `cb61e96`, `ce3648d`)
- Tool markers with nested parentheses like [tool: search_code(pub fn (ack|len), context=1) -> ok] now hoist into Block cards instead of leaking as raw text, with three call sites updated to a marker-bounded capture and the unicode arrow accepted everywhere. (`1c61ae3`)
- Dev-loop now auto-retries harness research-loop aborts: the completion-contract classifier recognises 'completed without any file operations' style failures, and the task-level gate falls through to the TASK_LEVEL_RETRY_BUDGET when no per-tool failures were recorded, giving task-shape failures a fresh-context retry. (`1943ec5`)

## Highlights

- Parallel chat sessions per agent instance, server + UI
- Dev-loop retries, orphan recovery, and synthesized failure reasons
- Stop now actually cancels the harness turn
- Per-task spinner and Play-loop glyph finally read as 'running'
- Windows CI unblocked for community PRs

