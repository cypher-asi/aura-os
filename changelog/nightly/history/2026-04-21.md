# Run history that survives reloads, plus a new Debug app

- Date: `2026-04-21`
- Channel: `nightly`
- Version: `0.1.0-nightly.328.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.328.1

Today's nightly focuses on making live automation state durable across reloads and reconnects, and introduces a full Debug app (and companion CLI) for inspecting dev-loop runs. The release pipeline also gained an automated screenshot-media workflow with manual reconciliation, and the browser backend was patched to finally surface the source of a long-running CDP log flood.

## 10:52 PM — Completed task output survives remounts and reloads

The Run panel's completed-task bodies now rehydrate from a structured on-disk cache instead of flashing empty after a reload or TTL eviction.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-completed-task-output-survives-remounts-and-reloads","slug":"completed-task-output-survives-remounts-and-reloads","alt":"Completed task output survives remounts and reloads screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-completed-task-output-survives-remounts-and-reloads -->

- Added a localStorage task-turn-cache that snapshots the full DisplaySessionEvent timeline, tool cards, and thinking steps on task completion, with a unified useTaskOutputView hook that falls back through live stream, cache, event store, and server hydration so expanding a completed row always renders real content. (`657ef48`)
- Tightened the Sidekick StatCard so compound values like "13m 53s" no longer wrap in the narrow column, while keeping the larger mobile variant intact. (`b2f4907`)

## 11:18 PM — Vendored chromiumoxide fork to unmask CDP message drift

The browser backend now runs against an in-tree chromiumoxide 0.9.1 fork so the constant "WS Invalid message" warnings finally carry the raw payload needed to identify which CDP schema drifted.

- Pinned chromiumoxide + subcrates under vendor/chromiumoxide via [patch.crates-io] and patched the handler to include the offending JSON payload on the WARN log, giving the next CDP session a concrete method name to target with serde rename fixes. (`81728bf`)

## 11:42 PM — Live automation state rehydrates cleanly after refresh

Sidekick spinners, active-task badges, and the stats grid now track the automation loop accurately across reloads and WS reconnects, with a cleanup of the long-dead bottom Task Output panel.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-live-automation-state-rehydrates-cleanly-after-refresh","slug":"live-automation-state-rehydrates-cleanly-after-refresh","alt":"Live automation state rehydrates cleanly after refresh screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-live-automation-state-rehydrates-cleanly-after-refresh -->

- Exposed the per-agent "currently streaming" task id via /loop/status, /loop/start, /loop/pause, /loop/stop, and /loop/resume, and taught the Run panel, Tasks list live dots, sidebar agent indicator, and mobile task views to seed themselves from it — so a page refresh no longer leaves spinners spinning against a dark UI. (`c16c726`)
- The Active stats card now uses the app-wide success green and updates optimistically from TaskStarted/Completed/Failed events scoped to the current project, so the dashboard tracks in-flight work in real time instead of waiting for a chat stream to end. (`9408bf2`)
- Each sidekick (main, agents, process) now remembers its last-active tab in localStorage, so the app no longer snaps back to terminal/profile/process after a refresh. (`8ec8861`)
- Removed the obsolete bottom TaskOutputPanel surface and its resize/collapse/tab persistence, including a one-shot cleanup of the stale aura-task-output-panel localStorage key. (`c351ca8`)

## 12:28 AM — Debug app, persisted dev-loop bundles, and aura-run-analyze CLI

Every dev-loop run is now captured to a structured on-disk bundle that powers a new Debug app, a heuristics engine, and a CI-gatable CLI.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-debug-app-persisted-dev-loop-bundles-and-aura-run-analyze-cli","slug":"debug-app-persisted-dev-loop-bundles-and-aura-run-analyze-cli","alt":"Debug app, persisted dev-loop bundles, and aura-run-analyze CLI screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-debug-app-persisted-dev-loop-bundles-and-aura-run-analyze-cli -->

- LoopLogWriter persists every run as metadata.json plus jsonl channels for events, LLM calls, iterations, blockers, and retries, exposed over a new /api/debug/* surface with per-channel logs and a zip export. (`c18bc88`)
- Added a Debug app (Bug icon, after Integrations) with a project/run nav, run list, and run detail view featuring a virtualized timeline, channel/type/text filters, JSON inspector, copy, and zip export for analyzing retries, blockers, and iteration cost. (`c18bc88`)
- Runs are now associated with the specs their tasks touched, surfaced as Project → Spec → Runs grouping in the Debug nav and a ?spec_id= filter on the runs API; a new aura-loop-log-schema crate plus aura-run-heuristics (seven rules) and an aura-run-analyze CLI (--latest/--run/--list, markdown or JSON, non-zero exit on findings) make run analysis scriptable from CI. (`ccea501`)
- Process runs now mirror the task turn-cache flow: a process-node-turn-cache seeds the Run preview's Live Output across reloads and WS reconnects, with a per-run liveRunNodeId so a stale pointer can't leak onto a subsequent run. The Run button and sidekick tab spinners also stay engaged through the HTTP→WS handoff by seeding live-task ids directly from /loop/start and /loop/resume. (`3156ede`, `9270310`)
- Disabled cargo color and progress output workspace-wide so agent/CI transports that base64-wrap streams return legible compiler diagnostics instead of ANSI blobs. (`de66693`)

## 4:31 PM — Automated changelog screenshot media pipeline

Release changelogs now publish their own screenshot media automatically, with a manual reconciliation workflow for backfills.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-automated-changelog-screenshot-media-pipeline","slug":"automated-changelog-screenshot-media-pipeline","alt":"Automated changelog screenshot media pipeline screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-automated-changelog-screenshot-media-pipeline -->

- Introduced a publish-release-changelog-media workflow plus demo screenshot capture scripts (Browserbase with local Playwright fallback, Anthropic-planned seeds, quality checks) that run after each successful changelog publish to attach media to the release. (`3b93c76`)
- Added a manual reconcile-release-changelog workflow that finds the latest successful release run for a channel, skips when no release was actually published, and supports refresh_existing to regenerate previously published media. (`839f657`)
- Hardened the media workflow's preview handling and realigned the changelog publish triggers so downstream media jobs fire off the correct events. (`9159a19`, `93dad69`)

## 7:56 PM — Changelog pipeline preflights and secret-sourced preview URL

Follow-up reliability fixes to the new changelog media pipeline.

- The media and reconcile workflows can now pull the preview URL from a repo secret when the dispatch input is empty, removing the need to paste it on every manual run. (`9e52bb8`)
- Tightened preflight checks across the publish, media, and reconcile workflows so misconfigured runs fail fast instead of part-way through capture. (`dc19892`)

## Highlights

- Structured task & process output now rehydrates after refresh
- New Debug app with on-disk run bundles and aura-run-analyze CLI
- Automated release changelog screenshot media pipeline
- Sidekick spinners and live badges stay in sync through reconnects

