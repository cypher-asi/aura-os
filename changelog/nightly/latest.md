# Run state that survives refresh, plus a new Debug app for dev-loop runs

- Date: `2026-04-21`
- Channel: `nightly`
- Version: `0.1.0-nightly.324.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.324.1

Today's nightly is heavy on durability: task and process-run output now rehydrate cleanly across reloads and WebSocket reconnects, the sidekick remembers where you were, and every dev-loop run is archived to disk behind a new Debug app and CLI. A vendored chromiumoxide fork unlocks deeper browser-backend debugging, and the release pipeline grew an automated screenshot media step.

## 10:52 PM — Task output survives reloads and stream pruning

The Run panel's completed task rows no longer flash empty after a refresh or idle timeout, and a small sidekick layout fix keeps compound timers on one line.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-task-output-survives-reloads-and-stream-pruning","slug":"task-output-survives-reloads-and-stream-pruning","alt":"Task output survives reloads and stream pruning screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-task-output-survives-reloads-and-stream-pruning -->

- Completed task rows now rehydrate their full timeline, tool cards, and thinking steps from a new localStorage turn cache, with a unified useTaskOutputView hook that walks live stream → turn cache → event store → server hydration so expanding a row after a reload or 5-minute idle never shows a blank body. (`657ef48`)
- Shrunk the sidekick StatCard value to 15px with nowrap so compound times like "13m 53s" stop wrapping in the narrow column, while the mobile variant keeps its larger size. (`b2f4907`)

## 11:18 PM — Vendored chromiumoxide fork to trace CDP schema drift

The browser backend's noisy "WS Invalid message" warnings can finally be diagnosed: chromiumoxide 0.9.1 is now vendored in-tree with a local patch that logs the offending CDP payload.

- Forked chromiumoxide 0.9.1 under vendor/chromiumoxide and pinned the workspace at it via [patch.crates-io], with a single local edit to the handler that attaches the raw JSON payload to the InvalidMessage warning — so each failing CDP method name is now visible and can be patched with targeted serde renames upstream. (`81728bf`)

## 11:42 PM — Live run state rehydrates across refresh

Several fixes close the gap where refreshing during an active run left spinners, badges, and panels out of sync with the automaton loop, plus a live-updating Active stat and a persisted sidekick tab.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-live-run-state-rehydrates-across-refresh","slug":"live-run-state-rehydrates-across-refresh","alt":"Live run state rehydrates across refresh screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-live-run-state-rehydrates-across-refresh -->

- Refreshing during an active run now correctly lights up the Run panel, the TaskList live dot, and the left-nav agent spinner: /loop/status, /loop/start, /loop/pause, /loop/stop, and /loop/resume all surface the currently streaming task id, and the UI seeds its stores from it on mount and reconnect instead of waiting for one-shot task_started WebSocket events. (`c16c726`)
- The sidekick Active stat card is now tinted with the standard success green and updates live via TaskStarted/TaskCompleted/TaskFailed subscriptions, so in-progress/done/failed counts track the automation loop in real time instead of waiting for a chat stream to end. (`9408bf2`)
- Each sidekick (main, agents, process) now remembers its last-active tab in localStorage, so the app no longer snaps back to terminal/profile/process after a refresh. (`8ec8861`)
- Retired the old bottom TaskOutputPanel surface that had been superseded by the Sidekick drawer, removing its resize handle, collapse state, tab switcher, and stale aura-task-output-panel localStorage key (with a one-shot cleanup for existing clients). (`c351ca8`)

## 12:28 AM — Debug app, run-analyze CLI, and persistent process Live Output

Every dev-loop run is now archived to disk and inspectable through a new in-app Debug surface and a Rust CLI with built-in heuristics; process runs gain the same reload-survives-refresh treatment as tasks.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-debug-app-run-analyze-cli-and-persistent-process-live-output","slug":"debug-app-run-analyze-cli-and-persistent-process-live-output","alt":"Debug app, run-analyze CLI, and persistent process Live Output screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-debug-app-run-analyze-cli-and-persistent-process-live-output -->

- Every dev-loop run is written to a structured on-disk bundle (metadata, events, LLM calls, iterations, blockers, retries, summary) via a new LoopLogWriter, exposed through /api/debug/* with project/run listings, per-channel logs, and a .zip export, and surfaced by a new Debug app featuring a virtualized run timeline, channel/type/text filters, a JSON inspector, and export. (`c18bc88`)
- Runs are now grouped by the specs their tasks touched (Project → Spec → Runs in the Debug nav, with a ?spec_id= filter), and a new aura-run-analyze CLI with seven heuristics — repeated blockers, high retry density, slow iteration, token-hog LLM calls, unbalanced I/O, never-completed tasks, zero-tool-call turns — emits markdown or JSON and exits non-zero so CI can gate on warnings or errors. Shared types live in a new aura-loop-log-schema crate. (`ccea501`)
- The process Run preview's Live Output panel now persists across reloads and WS reconnects via a new process-node-turn-cache and process-stream-bootstrap, with the focused node rehydrating to the correct run and the section retitled "Recent Live Output" when the run is no longer actively streaming. (`3156ede`)
- Clicking Run now keeps the button and sidekick Run/Tasks spinners engaged continuously from click through the first task_started event — including re-runs — by optimistically flipping preparing=true and seeding a shared live-task-ids store from the active_tasks returned by /loop/start and /loop/resume. (`9270310`)
- Disabled cargo color and progress output workspace-wide so agent/CI transports that Base64-wrap streams stop producing unreadable blobs of ANSI escapes and carriage-return progress updates in automated runs. (`de66693`)

## 4:31 PM — Automated screenshot media for the release changelog

The release pipeline now captures demo screenshots as part of publishing the changelog, with a dedicated follow-up workflow and matching trigger wiring.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-automated-screenshot-media-for-the-release-changelog","slug":"automated-screenshot-media-for-the-release-changelog","alt":"Automated screenshot media for the release changelog screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-automated-screenshot-media-for-the-release-changelog -->

- Added a Publish Release Changelog Media workflow plus a screenshot-first capture pipeline — Browserbase- or Playwright-backed — with a demo seed planner, agent brief and app catalog, screenshot quality checks, and an in-app capture bridge, all documented in docs/demo-screenshot-pipeline.md. (`3b93c76`)
- Realigned the publish-release-changelog workflow's triggers so the new media job runs on the right events without racing the changelog publish step. (`9159a19`)

## Highlights

- Task output and sidekick stats survive reloads
- New Debug app + aura-run-analyze CLI for dev-loop runs
- Run spinners stay accurate through refresh and re-runs
- Release changelog now auto-captures screenshot media

