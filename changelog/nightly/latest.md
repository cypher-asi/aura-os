# Autonomous recovery, debug app overhaul, and a smoother chat stream

- Date: `2026-04-22`
- Channel: `nightly`
- Version: `0.1.0-nightly.344.1`
- Release: https://github.com/cypher-asi/aura-os/releases/tag/v0.1.0-nightly.344.1

A heavy day for Aura's internals: the dev loop learned to recognise provider rate limits and recover from them, oversized tasks now get decomposed before they can fail, and a new heuristics pipeline drives automatic remediation. On the surface, the Debug app was rebuilt around projects and a sidekick-driven inspector, the live chat stream got calmer and more legible, and the Windows auto-updater now hands off to NSIS reliably.

## 2:06 AM — Debug app reorganized around projects, plus chat and tool-output fixes

A major rework of the Debug app alongside targeted fixes for agent-busy chat state, ANSI-colored tool output, and smaller UI polish.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-debug-app-reorganized-around-projects-plus-chat-and-tool-output-","slug":"debug-app-reorganized-around-projects-plus-chat-and-tool-output-","alt":"Debug app reorganized around projects, plus chat and tool-output fixes screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-debug-app-reorganized-around-projects-plus-chat-and-tool-output- -->

- Rebuilt the Debug app around a project-first left nav and a dedicated sidekick: the run toolbar, counters, and entry inspector moved into tabbed panels (Run, Events, LLM, Iterations, Blockers, Retries, Stats, Tasks), the type-filter dropdown is now portal-backed so it no longer clips, and JSONL rows no longer show 'unknown' for type/timestamp. Follow-ups mounted the sidekick via registry flags, stabilized the run-detail header to a single non-wrapping line, and added Copy All / Copy Filtered / Export buttons at the top of the run view. (`8e7e4f0`, `1b769a8`, `865e7ec`, `586f744`)
- Chat input now correctly reflects agent-busy state: a new useAgentBusy hook combines SSE streaming and loop-active state so the stop icon appears whenever the agent is busy, /loop/stop is wired up when the automation loop holds the turn, and the server returns a typed 409 agent_busy that renders as a friendly message instead of the raw harness string. (`6dd691e`)
- Task output from colored CLIs (cargo, rustc, npm) now renders as legible text: the base64 decoder lets ANSI escapes through, strips them from the decoded output, and recurses into additional output fields so previews no longer surface raw base64. (`7822fa1`)
- Fixed a leaderboard horizontal scrollbar by removing a nested scroll wrapper, softened run/task card borders, and tightened the loop_log counters to stop double-counting mid-stream token frames while adding a first-class narration_deltas signal. (`13e2cae`, `a6f3a4c`, `f5921f6`)

## 5:49 PM — Remediation hints on every heuristic finding

Run-analysis findings now carry an actionable next-step hint, laying the groundwork for autonomous recovery.

- Each heuristic rule (zero-tool-calls, repeated blockers, task-never-completed, token-hog, and more) now populates a RemediationHint variant such as SplitWriteIntoSkeletonPlusAppends, ReshapeSearchQuery, or ForceToolCallNextTurn, and aura-run-analyze renders it as a compact `fix:` one-liner under each finding. (`6b6d6d9`)

## 6:05 PM — Stronger borders on run and task output blocks

Tightened the visual weight of run-timeline and task-output containers to match the standard block outline.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-stronger-borders-on-run-and-task-output-blocks","slug":"stronger-borders-on-run-and-task-output-blocks","alt":"Stronger borders on run and task output blocks screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-stronger-borders-on-run-and-task-output-blocks -->

- Run event timeline rows and task live/build output blocks now use the standard --color-border token instead of the lighter variant, aligning them with the shared .block primitive outline. (`b2f25e4`)

## 6:13 PM — Automatic task decomposition after truncation failures

The dev loop now acts on remediation hints to split, reshape, or retry failed tasks instead of just retrying blindly.

- When a task fails with a truncation or no-file-ops reason, the server loads the run bundle, runs heuristics, and follows the first RemediationHint: SplitWriteIntoSkeletonPlusAppends spawns a skeleton + fill pair, while ReshapeSearchQuery and ForceToolCallNextTurn spawn a single shaped-retry child. The parent transitions to failed, a task_auto_remediated event is broadcast for the UI, MAX_RETRIES_PER_TASK is respected, and AURA_AUTO_DECOMPOSE_DISABLED=1 falls back to the classic retry path. (`79eab49`)

## 6:40 PM — Unified chat border inside sidekick and preview overlays

Propagated the main chat's darker border token into the sidekick body and preview overlay for consistent outlines.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-unified-chat-border-inside-sidekick-and-preview-overlays","slug":"unified-chat-border-inside-sidekick-and-preview-overlays","alt":"Unified chat border inside sidekick and preview overlays screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-unified-chat-border-inside-sidekick-and-preview-overlays -->

- Pulled the ChatPanel --color-border override (#17171a) up into the sidekick and preview overlay so tables, blocks, tools, and output sections render with the same subtle outline as the LLM chat. (`cc9a050`)

## 6:45 PM — Autonomous recovery pipeline, Windows updater fix, and a new login screen

The largest batch of the day: preflight task decomposition, live heuristics, provider Retry-After handling, a DoD gate for code tasks, a reliable Windows auto-update handoff, a redesigned login view, and a string of streaming-UI and Debug polish fixes.

<!-- AURA_CHANGELOG_MEDIA:BEGIN {"slotId":"entry-autonomous-recovery-pipeline-windows-updater-fix-and-a-new-login","slug":"autonomous-recovery-pipeline-windows-updater-fix-and-a-new-login","alt":"Autonomous recovery pipeline, Windows updater fix, and a new login screen screenshot"} -->
<!-- AURA_CHANGELOG_MEDIA:PENDING -->
<!-- AURA_CHANGELOG_MEDIA:END entry-autonomous-recovery-pipeline-windows-updater-fix-and-a-new-login -->

- The dev loop now catches oversized tasks before they run: detect_preflight_decomposition flags specs whose title or body signals a likely large generation and splits them into [skeleton] + [fill] children at creation time, broadcasting a task_preflight_decomposed event. The skeleton+fill fan-out is shared with the post-failure remediation path, and a new LiveAnalyzer re-runs heuristics every 50 events / 30 seconds / on task_failed during an active run and emits dev_loop_advisory events mid-flight. A replay integration test and a golden test for aura-run-analyze pin the full decision chain. (`4f8e0a6`, `097b5a5`, `6de6a5e`)
- Rate-limit recovery is now provider-aware and self-healing: a new FailureClass::RateLimited is checked before Truncation, extract_retry_after parses structured fields and free-text hints ('retry after N', 'retry in Ns') out of task_failed events, and project cooldowns raise to max(class default, hint) clamped to 120s. Restart conflicts are resolved the same way start_loop does (stop stale / adopt live), a ready→in_progress→failed bridge fixes an illegal transition, and the UI's TaskOutputSection now renders 'Rate limited by provider — resuming in Ns...' via a new useCooldownStatus hook instead of sitting on 'Waiting for agent output'. A git push timeout after a successful commit is also reclassified as non-fatal and the task moves to done. (`dc50429`, `53dec4d`, `2d0124d`, `a7f8494`, `7a735ec`)
- Task completion now requires real verification evidence. Any task that modified files must show at least one build and one test step in telemetry, Rust source changes must additionally show cargo fmt and clippy, and docs-only edits pass without build/test. A new task_completion_gate domain event captures the inputs and pass/fail reason for each transition. create_task is also idempotent on (project, spec, normalized title) so rerunning generate-spec → extract-tasks no longer doubles the task list, and task_failed now persists execution_notes even when no session_id has been recorded yet. (`371aacf`, `15c8728`, `8fb8af9`, `f7914db`)
- Desktop: the Windows auto-updater now takes direct control of the NSIS handoff, staging the verified installer under <data_dir>/runtime/updater, running the shutdown hook to kill sidecars, and spawning setup with DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP so the installer survives Aura's exit. The Updates row in settings splits into a compact inline control and a full-width attention panel for available / downloading / installing / failed states, and the local auto-update smoke test gained a Windows leg. Main-window live resize is now fluid: useAuraCapabilities dedupes through a single useSyncExternalStore snapshot, and the class background brush switched from BLACK_BRUSH to NULL_BRUSH to eliminate black bars chasing the resize edge. Separately, the IDE window webview now receives the auth bootstrap script so API calls stop failing with 'missing authorization token'. (`61300eb`, `88a1fee`, `dd97291`, `9993d15`)
- Live LLM streaming got a structural rewrite: text deltas strictly append to the timeline tail (arrival order == render order), getStreamSafeContent smooths trailing dangling `*` / `_` markers so raw emphasis no longer flashes under the cursor, and a new isWriting signal drives a ChatStreamingIndicator that's pinned above the input bar instead of jittering the message flow. The indicator is lifted above the input fade, aligned to the text column, and tab overflow in the Debug sidekick no longer flickers a ghost icon next to the More button. (`aabd229`, `c4f512d`, `16f38ac`, `764be8b`)
- Debug app polish: a new 'Running now' section lists in-progress runs across every project (polling at 3s active / 10s idle), the sidekick Run tab and entry inspector left-align with field labels above, the middle-panel timeline no longer flips channels when sidekick tabs change, and third-column payload JSON is replaced with readable task / tool names. Expand/collapse, last project, and last run now persist across reloads via a new DebugIndexRedirect, Copy All flips to a transient 'Copied' confirmation, and orphan Running bundles are reconciled to Interrupted on server startup and on stop/restart so ghost live runs no longer linger. (`46ae8e9`, `5e25855`, `ea9ab6e`, `4f83bcf`, `3855508`)
- Tool output renderers got trustworthy: Command and read_file blocks now decode the base64 stdout/stderr envelope and render syntax-highlighted file contents instead of a raw JSON blob, ListBlock extracts rows from the same envelope so list_files / find_files / search_code no longer render '0 items', and GenericToolBlock restores its 10px inset by rendering JSON containers as <div>s so the block reset doesn't strip their padding. Logging out no longer lands on a black-screen redirect loop — a new aura-force-logged-out sentinel survives the desktop init script's auth literals, and local cleanup now runs even if the server logout call throws. (`45e55ba`, `59d2aa6`, `f62eb9d`, `2ab59d4`)
- The login screen was redesigned around a full-width AURA_visual_loop background video with a translucent glass sign-in card centered above it, titled 'Login with ZERO Pro' and narrowed to 308px. Billing email is now read-only and tied to the ZERO account identity, fixing a regression that booted users into a Free-plan state when the stored value drifted. A stray wrapper in standalone agent chat is now a proper flex-column filler so the transcript scrolls again, and the tasks sidekick no longer blinks between re-renders. (`dacd52e`, `3fdb15e`, `df72d28`, `3969c21`, `04b5496`, `a68d479`, `68ea3aa`, `27d79bd`, `fe06055`)
- Release infrastructure: the publish-changelog-media workflow now commits successful screenshots before dispatching a retry for the failed ones, a new retry-release-changelog-media workflow picks up the queued plan, and partial-success policy is unified across publish, reconcile, and retry. The changelog media proof capture and seed planner were hardened with tolerant JSON extraction, and candidate inference in generate-daily-changelog was tightened. (`2f96782`, `14a67af`, `9005c60`, `e0b0ade`, `eb42a29`, `027e0e2`)
- Promoted the darker --color-border token globally so tables, tool rows, message bubbles, preview overlays, task/terminal panels, and sidekick surfaces all share one outline, and dropped now-redundant per-container overrides. Block titles get a bit of trailing padding so long command names no longer ellipsize flush against EXIT badges, and StatCard always shows two decimals for dollar values. (`150f142`, `ed2e669`, `773a3a8`, `070248d`)

## Highlights

- Debug app rebuilt around projects and a sidekick inspector
- Dev loop auto-decomposes oversized tasks and respects provider Retry-After
- Windows auto-updater now hands off to NSIS reliably
- Definition-of-Done gate now requires build+test (and fmt/clippy for Rust)
- Chat stream renders linearly with a non-jittery phase indicator

